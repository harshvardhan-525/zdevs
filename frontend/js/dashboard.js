// BHOOMI - Interactive Geospatial Dashboard

document.addEventListener("DOMContentLoaded", function () {

    console.log("BHOOMI Dashboard Initialized");

    const mapElement = document.getElementById("climate-map");

    if (!mapElement) {
        console.error("Map element not found!");
        return;
    }

    if (typeof L === "undefined") {

        mapElement.innerHTML =
            "<p style='padding:20px;color:white'>Map library failed to load. Check your internet connection.</p>";

        console.error("Leaflet library not loaded");

        return;
    }


    // Prayagraj coordinates
    const prayagraj = [25.4358, 81.8463];


    // Initialize map
    const map = L.map("climate-map", {
        scrollWheelZoom: true
    }).setView(prayagraj, 10);


    // Satellite imagery layer
    L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
            attribution: "Tiles &copy; Esri",
            maxZoom: 18
        }
    ).addTo(map);


    // Monitoring location marker
    L.circleMarker(prayagraj, {

        radius: 8,

        color: "#00E5FF",

        weight: 2,

        fillColor: "#00E5FF",

        fillOpacity: 0.85

    })

    .addTo(map)

    .bindPopup(
        "<strong>BHOOMI Monitoring Point</strong><br>Prayagraj, Uttar Pradesh"
    );


    // Fix map dimensions after page rendering
    setTimeout(function () {

        map.invalidateSize();

    }, 150);


    console.log("BHOOMI Satellite Map Loaded");

});