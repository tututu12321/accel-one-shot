let running = false;
let maxA = 0;

function start() {
    maxA = 0;
    running = true;

    if (typeof DeviceMotionEvent.requestPermission === 'function') {
        DeviceMotionEvent.requestPermission()
            .then(response => {
                if (response === 'granted') {
                    window.addEventListener('devicemotion', onMotion);
                }
            });
    } else {
        window.addEventListener('devicemotion', onMotion);
    }
}

function stop() {
    running = false;
}

function onMotion(event) {
    if (!running) return;

    let ax = event.accelerationIncludingGravity.x || 0;
    let ay = event.accelerationIncludingGravity.y || 0;
    let az = event.accelerationIncludingGravity.z || 0;

    let a = Math.sqrt(ax*ax + ay*ay + az*az);

    if (a > maxA) maxA = a;

    document.getElementById("ax").innerText = ax.toFixed(2);
    document.getElementById("ay").innerText = ay.toFixed(2);
    document.getElementById("az").innerText = az.toFixed(2);
    document.getElementById("amag").innerText = a.toFixed(2);
    document.getElementById("max").innerText = maxA.toFixed(2);
}
