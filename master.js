var express = require('express');
var app = express();
var server = require('http')
  .createServer(app);
var crypto = require('crypto');
var util = require('util');
var ursa = require('ursa');
var fs = require('fs');
var log = require('./log');

var config = require('./master_config');

var redisClient = require('redis')
  .createClient(config.redis.port, config.redis.address);

redisClient.select(config.redis.databaseId);

app.use(express.bodyParser());
app.use(function(req,res,next){
  res.header('Access-Control-Allow-Origin', 'http://foo.com');
  res.header('Access-Control-Allow-Methods', 'POST, GET');
  next()
});
app.enable("jsonp callback");
server.listen(config.listen.port, config.listen.address);

var serverList = config.serverList;
var serverKeySlot = {};

serverList.forEach(function(serverAddress) {
  try {
    var md5 = crypto.createHash('md5')
      .update(serverAddress)
      .digest("hex");
    var keyPem = fs.readFileSync(__dirname + '/keys/' + md5 + '.pem');
    serverKeySlot[serverAddress] = ursa.createPrivateKey(keyPem);
    log.info(util.format('Private key loaded for node server "%s"', serverAddress));
  } catch(e) {
    log.warning(util.format('Cannot load private key for node server "%s"', serverAddress));
  }
});

var lastUsedServerIndex = 0;
function pickServer(sourceIP) {
  if (lastUsedServerIndex == serverList.length) {
    lastUsedServerIndex = 0;
  }
  return serverList[lastUsedServerIndex++];
}

function signature(serverAddress, actionString) {
  log.info(util.format('Signature action "%s" for node server "%s"', actionString, serverAddress));
  var serverkey = serverKeySlot[serverAddress];
  var signature = serverkey.hashAndSign('sha256', actionString, 'utf8', 'base64');
  return signature;
}

function generateNewRoomId(callback) {
  var id = (Math.random() * 1000000000 | 0)
    .toString(36);
  redisClient.exists('ChatRoom.' + id, function(error, exist) {
    if (exist) {
      generateNewRoomId(callback);
    } else {
      callback(id);
    }
  });
}

app.post('/chatroom', function(req, res) {
  var nickname = req.body.sponsorNickname;
  var title = req.body.title;
  var createDate = Date.now() / 1000 | 0;

  if (!nickname || !title) {
    res.jsonp({}, 400);
    return;
  }

  generateNewRoomId(function(id) {
    var serverAddress = pickServer(req.ip);
    log.info(util.format('User "%s" request to create new chat room "%s", assigning node server "%s"', nickname, title, serverAddress))
    var newRoomInfo = {
      title: title,
      createDate: createDate.toString(),
      serverAddress: serverAddress
    };
    redisClient.hmset('ChatRoom.' + id, newRoomInfo, function() {
      redisClient.sadd('ChatRoom.Members.' + id, nickname, function() {
        var joinActionString = util.format("JOINROOM:%s|%s", id, nickname);
        res.jsonp({
          roomId: id,
          shortlink: 'http://gchat.in/' + id,
          signature: signature(serverAddress, joinActionString),
          createDate: createDate,
          serverAddress: serverAddress
        });
      });
    });
  });
});

app.post('/chatroom/:roomId/members', function(req, res) {
  var roomId = req.params.roomId;
  var nickname = req.body.nickname;

  log.info(util.format('User "%s" request to join room "%s"', nickname, roomId));

  if (!nickname) {
    res.jsonp({}, 400);
    return;
  }

  redisClient.exists('ChatRoom.' + roomId, function(error, exist) {
    if (!exist) {
      log.info(util.format('Room "%s" does not exist!', roomId));
      res.jsonp({}, 404);
      return;
    } else {
      redisClient.sadd('ChatRoom.Members.' + roomId, nickname, function(error, nonexist) {
        if (!nonexist) {
          log.warning(util.format('User "%s" already in room "%s", reject.', nickname, roomId));
          res.jsonp({}, 409);
        } else {
          redisClient.hmget('ChatRoom.' + roomId, ['createDate', 'title', 'serverAddress'], function(error, result) {
            var joinActionString = util.format('JOINROOM:%s|%s', roomId, nickname);
            var serverAddress = result[2];
            var createDate = result[0] - 0;
            var title = result[1];
            res.jsonp({
              roomId: roomId,
              shortlink: 'http://gchat.in/' + roomId,
              signature: signature(serverAddress, joinActionString),
              createDate: createDate,
              serverAddress: serverAddress,
              title: title
            });
          });
        }
      });
    }
  });
});

app.get('/chatroom/:roomId', function(req, res) {
  var roomId = req.params.roomId;

  redisClient.exists('ChatRoom.' + roomId, function(error, exist) {
    if (!exist) {
      log.info(util.format('Room "%s" does not exist!', roomId));
      res.jsonp({}, 404);
      return;
    }
    redisClient.hmget('ChatRoom.' + roomId, ['createDate', 'title', 'serverAddress'], function(error, result) {
      redisClient.smembers('ChatRoom.Members.' + roomId, function(error, members) {
        var serverAddress = result[2];
        var createDate = result[0] - 0;
        var title = result[1];
        res.jsonp({
          roomId: roomId,
          shortlink: 'http://gchat.in/' + roomId,
          members: members,
          createDate: createDate,
          serverAddress: serverAddress,
          title: title
        });
      });
    });
  });
});



redisClient.on("error", function(err) {
  log.error("Redis client error: " + err);
});

app.get('/', function(req, res) {
  res.jsonp({}, 200);
});
