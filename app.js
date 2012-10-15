var x = 0,
    y = 1,
    width = 480,
    height = 320,
    sampleSize = 1;

var sourceCanvas = $('#Source')[0],
    destinationCanvas = $('#Destination')[0];

var sourceContext = sourceCanvas.getContext('2d'),
    destinationContext = destinationCanvas.getContext('2d');

var sample = new Image();
sample.src = 'sample-image.jpeg';
sample.onload = function() {
	sourceContext.drawImage(sample, 0, 0, sourceCanvas.width, sourceCanvas.height);
	drawToDestination(y);
};

$(sourceCanvas).on({
	mousemove: function(e) {
		var y = e.y - e.target.offsetTop;
		drawToDestination(y);
	},
	click: function(e) {
		console.log('clone canvas');
	}
});

var drawToDestination = function(y) {
	var pixelData = sourceContext.getImageData(x, y, width, sampleSize);
	for (var yy = 0; yy < destinationCanvas.height; yy++) {
		destinationContext.putImageData(pixelData, x, yy);
	}
};

var drawSampleLine = function(y) {
	sourceContext.beginPath();
	sourceContext.moveTo(0, y);
	sourceContext.lineTo(width, y);
	sourceContext.closePath();
	sourceContext.stroke();
};
