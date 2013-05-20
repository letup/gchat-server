var express = require('express');
var app = express();
var server = require('http')
	.createServer(app);
var redis = require('redis');
var io = require('socket.io')
	.listen(server);

app.use(express.bodyParser());
server.listen(8000);
io.set('log level', 1);

var redisClient = redis.createClient('6379', '127.0.0.1')

app.get('/', function(req, res) {
	res.sendfile(__dirname + '/index.html');
});

app.post('/chatroom', function(req, res) {
  var nickname = req.body.sponsorNickname;
  var title = req.body.title;
  var createDate = Date.now() / 1000 | 0;

  if (!nickname || !title) {
    res.json({}, 400);
  }
  
  function generateId() {
    var id = (Math.random() * 1000000 | 0)
      .toString(36);
    redisClient.sadd('ChatRoom.IDs', id, function(error, nonexist) {
      if (!nonexist) {
        generateId();
      } else {
        redisClient.hmset('ChatRoom.' + id, {
          title: title,
          createDate: createDate.toString()
        }, function(error) {
          redisClient.sadd('ChatRoom.Members.' + id, nickname, function(error, nonexist) {
            res.json({
              roomID: id,
              shortlink: 'http://gchat.in/' + id,
              token: 'TOKEN_NULL',
              createDate: createDate,
              serverAddress: '192.168.1.153:8000'
            });
          });
        });
      }
    });
  }
  generateId();
});

app.get('/chatroom/:roomID' , function(req, res) {
  var roomID = req.params.roomID;
  
  redisClient.sismember('ChatRoom.IDs', roomID, function(error, exist) {
    if (!exist) {
      res.json({}, 404);
    }
  
    var count = parseInt(req.query.count, 10);
    var startID = parseInt(req.query.startID, 10);
    var endID = parseInt(req.query.endID, 10);
    
    if (startID && endID) {
      if (endID - startID < 0) {
        res.json({}, 400);
      }
      redisClient.lrange('ChatRoom.Messages.' + roomID, startID, endID - 1, function(error, result) {
        var chats = result.map(function(item) { return JSON.parse(item); });
        res.json({chats: chats}, 200);
      });
    } else if (startID && count) {
      redisClient.lrange('ChatRoom.Messages.' + roomID, startID, startID + count - 1, function(error, result) {
        var chats = result.map(function(item) { return JSON.parse(item); });
        res.json({chats: chats}, 200);
      });
    } else if (endID && count) {
      var startP = endID - count;
      if (startP < 0) startP = 0;
      redisClient.lrange('ChatRoom.Messages.' + roomID, startP, endID - 1, function(error, result) {
        var chats = result.map(function(item) { return JSON.parse(item); });
        res.json({chats: chats}, 200);
      });
    } else if (endID) {
      redisClient.lrange('ChatRoom.Messages.' + roomID, 0, endID - 1, function(error, result) {
        var chats = result.map(function(item) { return JSON.parse(item); });
        res.json({chats: chats}, 200);
      });
    } else if (count) {
      redisClient.lrange('ChatRoom.Messages.' + roomID, -count, -1, function(error, result) {
        var chats = result.map(function(item) { return JSON.parse(item); });
        res.json({chats: chats}, 200);
      });
    } else {
      redisClient.lrange('ChatRoom.Messages.' + roomID, startID || 0, -1, function(error, result) {
        var chats = result.map(function(item) { return JSON.parse(item); });
        res.json({chats: chats}, 200);
      });
    }
  });
});

app.post('/chatroom/:roomID/join', function(req, res) {
  var roomID = req.params.roomID;
  var nickname = req.body.nickname;
  
  console.log(nickname + " want to join room " + roomID);
  
  if (!nickname) {
    res.json({}, 400);
  }
  
  redisClient.sismember('ChatRoom.IDs', roomID, function(error, exist) {
    if (!exist) {
      res.json({}, 404);
    }
    
    redisClient.sadd('ChatRoom.Members.' + roomID, nickname, function(error, nonexist) {
      // if (!nonexist) {
      //   res.json({}, 409);
      // } else {
        redisClient.hmget('ChatRoom.' + roomID, ["createDate", "title"], function(error, result) {
          res.json({
            roomID: roomID,
            shortlink: 'http://gchat.in/' + roomID,
            token: 'TOKEN_NULL',
            createDate: result[0],
            serverAddress: '192.168.1.153:8000',
            title: result[1]
          });
        });
      // }
    });
  });
});

io.set('authorization', function(handshakeData, callback){
	var roomID = handshakeData.query.roomID;
	var nickname = handshakeData.query.nickname;
	var token = handshakeData.query.token;
	if (!(roomID && nickname && token)) {
    callback(null, false);
	}
  //TODO: auth user token
  
  callback(null, true);
});

io.sockets.on('connection', function(socket) {
  var roomID = socket.handshake.query.roomID;
  var nickname = socket.handshake.query.nickname;
	console.log('Client connected to room ' + roomID + ', nickname: ' + nickname);
	socket.join(roomID);
	socket.on('chat message', function(msg, callback) {
		console.log('Client send message in room ' + roomID + ': ' + msg.body);
    var now = Date.now() / 1000 | 0;
    redisClient.llen('ChatRoom.Messages.' + roomID, function(error, expectMessageID) {
      expectMessageID += 1;
      var data = {
        body: msg.body,
        time: now,
        senderName: nickname,
        type: 'chat',
        id: expectMessageID
      };
      redisClient.rpush('ChatRoom.Messages.' + roomID, JSON.stringify(data), function(error, count) {
        if (expectMessageID != count) {
          //TODO: solve conflict
        }
        console.log('Room ' + roomID + ' now has ' + count + ' messages.');
        callback(count);
      
        socket.broadcast.to(roomID).emit('chat message', data);
      });
    });
	});
});
