var express = require('express');
var app = express();
var server = require('http')
  .createServer(app);
var crypto = require('crypto');
var util = require('util');
var ursa = require('ursa');
var fs = require('fs');

var config = require('./config');

var redisClient = require('redis')
  .createClient(config.redis.port, config.redis.address);

app.use(express.bodyParser());
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
  } catch(e) {
    console.log(util.format('WARNING: Cannot load private key for node server "%s"', serverAddress));
  }
});


function pickServer(sourceIP) {
  return serverList[0];
}

function signature(serverAddress, actionString) {
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
    res.json({}, 400);
    return;
  }

  generateNewRoomId(function(id) {
    var serverAddress = pickServer(req.ip);
    var newRoomInfo = {
      title: title,
      createDate: createDate.toString(),
      serverAddress: serverAddress
    };
    redisClient.hmset('ChatRoom.' + id, newRoomInfo, function() {
      redisClient.sadd('ChatRoom.Members.' + id, nickname, function() {
        var joinActionString = util.format("JOINROOM:%s|%s", id, nickname);
        res.json({
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

  console.log(util.format('"%s" request to join room "%s"', nickname, roomId));

  if (!nickname) {
    res.json({}, 400);
    return;
  }

  redisClient.exists('ChatRoom.' + roomId, function(error, exist) {
    if (!exist) {
      console.log(util.format('Room "%s" does not exist!', roomId));
      res.json({}, 404);
      return;
    } else {
      redisClient.sadd('ChatRoom.Members.' + roomId, nickname, function(error, nonexist) {
        if (!nonexist) {
          console.log(util.format('"%s" already in room "%s", reject.', nickname, roomId));
          res.json({}, 409);
        } else {
          redisClient.hmget('ChatRoom.' + roomId, ['createDate', 'title', 'serverAddress'], function(error, result) {
            var joinActionString = util.format('JOINROOM:%s|%s', roomId, nickname);
            var serverAddress = result[2];
            var createDate = result[0] - 0;
            var title = result[1];
            res.json({
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

redisClient.on("error", function(err) {
  console.log("Redis client error: " + err);
});

app.get('/', function(req, res) {
  res.json({}, 200);
});
