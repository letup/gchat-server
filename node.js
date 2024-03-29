var express = require('express');
var app = express();
var server = require('http')
	.createServer(app);
var redis = require('redis');
var util = require('util');
var ursa = require('ursa');
var fs = require('fs');
var crypto = require('crypto');
var io = require('socket.io')
	.listen(server);  
var log = require('./log');

var config = require('./node_config');

io.set('log level', 0);

var redisClient = require('redis')
  .createClient(config.redis.port, config.redis.address);

redisClient.select(config.redis.databaseId);

app.use(express.bodyParser());
app.enable("jsonp callback");
server.listen(config.listen.port, config.listen.address);

var serverAddress = config.serverAddress;
var publicKey;

try {
  var md5 = crypto.createHash('md5')
    .update(serverAddress)
    .digest("hex");
  var keyPem = fs.readFileSync(__dirname + '/public_keys/' + md5 + '.pub');
  publicKey = ursa.createPublicKey(keyPem);
  log.info(util.format('Public key loaded for node server "%s"', serverAddress));
} catch(e) {
  log.warning(util.format('Cannot load public key for node server "%s"', serverAddress));
}

app.get('/chatroom/:roomId/messages' , function(req, res) {
  var roomId = req.params.roomId;
  
  redisClient.sismember('ChatRoom.IDs', roomId, function(error, exist) {
    if (!exist) {
      res.jsonp({}, 404);
      return;
    }
  
    var count = parseInt(req.query.count, 10);
    var startID = parseInt(req.query.startID, 10) - 1;
    var endID = parseInt(req.query.endID, 10) - 1;
    
    if ((!isNaN(startID) && startID <= 0)||(!isNaN(endID) && endID <= 0)) {
      res.jsonp({}, 400);
      return;
    }
    
    var startRange;
    var endRange;
    
    if (!isNaN(startID) && !isNaN(endID)) {
      if (endID - startID < 0) {
        res.jsonp({}, 400);
      }
      startRange = startID;
      endRange = endID - 1;
    } else if (!isNaN(startID) && !isNaN(count)) {
      startRange = startID;
      endRange = startID + count - 1;
    } else if (!isNaN(endID) && !isNaN(count)) {
      startRange = endID - count;
      if (startRange < 0) startRange = 0;
      endRange = endID - 1;
    } else if (!isNaN(endID)) {
      startRange = 0;
      endRange = endID - 1;
    } else if (!isNaN(count)) {
      startRange = -count;
      endRange = -1;
    } else {
      startRange = startID || 0;
      endRange = -1;
    }
    
    log.info('Fetch room "' + roomId + '" messages, query: startID=' + startID + ',endID=' + endID + ',count=' + count + '. lrange: start=' + startRange + ',end=' + endRange);
    
    redisClient.lrange('ChatRoom.Messages.' + roomId, startRange, endRange, function(error, result) {
      var messageId = startRange;
      var chats = result.map(function(item) { 
         var message = JSON.parse(item); 
         message.id = messageId + 1;
         messageId++;
         return message;
       });
      res.jsonp({chats: chats}, 200);
    });
  });
});

function verifySignature(actionString, signature) {
  try {
    var buffer = new Buffer(actionString, 'utf8');
    return publicKey.hashAndVerify('sha256', buffer, signature, 'base64');
  } catch(e) {
    return false;
  }
}

io.set('authorization', function(handshakeData, callback){
	var roomId = handshakeData.query.roomId;
	var nickname = handshakeData.query.nickname;
	var signature = handshakeData.query.signature;
  
	if (!(roomId && nickname && signature)) {
    log.warning('Invaild handshake params');
    callback(null, false);
    return;
	}
  
  log.info(util.format('User "%s" is trying to join room "%s"', nickname, roomId));
  
  var joinActionString = util.format('JOINROOM:%s|%s', roomId, nickname);
  var verifyResult = verifySignature(joinActionString, signature);
  
  callback(null, verifyResult);
});

io.sockets.on('connection', function(socket) {
  var roomId = socket.handshake.query.roomId;
  var nickname = socket.handshake.query.nickname;

  log.info('Client connected to room ' + roomId + ', nickname: ' + nickname);

  redisClient.sadd('ChatRoom.IDs', roomId, function(error, nonexist) {
    if (nonexist) {
      log.info(util.format('Room "%s" not exist, creating new.', roomId));
    }
    socket.join(roomId);
    socket.on('chat message', function(msg, callback) {
      log.info('User "' + nickname + '" send message in room "' + roomId + '": ' + msg.body);
      var now = Date.now() / 1000 | 0;
      
      var data = {
        body: msg.body,
        time: now,  
        senderName: nickname,
        type: 'chat',
      };
      redisClient.rpush('ChatRoom.Messages.' + roomId, JSON.stringify(data), function(error, count) {
        log.info('Room "' + roomId + '" now has ' + count + ' messages.');
        if (callback) {
          callback(count);
        }

        data.id = count;
        socket.broadcast.to(roomId)
          .emit('chat message', data);
      });
    });
  });
});

app.get('/', function(req, res) {
  res.jsonp({}, 200);
});

redisClient.on("error", function(err) {
  log.error("Redis client error: " + err);
});