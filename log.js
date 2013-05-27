var red, green, reset;
red = '\033[31m';
green = '\033[32m';
reset = '\033[0m';

var dateString = function() {
  return dateStr = (new Date())
    .toJSON();
}

exports.info = function(message) {
  console.log(dateString() + ' ' + green + 'INFO ' + reset + message);
}

exports.error = function(message) {
  var now = new Date();
  var dateStr = now.toJSON();
  console.log(dateString() + ' ' + red + 'ERROR ' + reset + message);
}

exports.warning = function(message) {
  var now = new Date();
  var dateStr = now.toJSON();
  console.log(dateString() + ' ' + red + 'WARNING ' + reset + message);
}
