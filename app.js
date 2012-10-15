var x = 0,
    y = 75,
    width = 480,
    height = 320,
    sampleSize = 1;

var sourceCanvas = $('#Source')[0],
    destinationCanvas = $('#Destination')[0];

console.log(sourceCanvas);

var sourceContext = sourceCanvas.getContext('2d'),
    destinationContext = destinationCanvas.getContext('2d');

var sample = new Image();
sample.src = 'sample-image.jpeg';
sample.onload = function() {
	sourceContext.drawImage(sample, 0, 0, sourceCanvas.width, sourceCanvas.height);
	drawToDestination(y);
};

$(sourceCanvas).on('click', function(e) {
	var yClick = e.y - e.target.offsetTop;
	drawToDestination(yClick);
});

var drawToDestination = function(y) {
	console.log('Sampling at ' + y + 'px');
	for (x=0; x < sourceCanvas.width; x++) {
		pixelData = sourceContext.getImageData(x, y, sampleSize, sampleSize);
		for (var yy = 0; yy < destinationCanvas.height; yy++) {
			destinationContext.putImageData(pixelData, x, yy);
		}
	}
};
