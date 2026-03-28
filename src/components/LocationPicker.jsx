import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const greenIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41],
});

function ClickHandler({ onPickup, onDestination, mode }) {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      if (mode === 'pickup') onPickup(lat, lng);
      else onDestination(lat, lng);
    },
  });
  return null;
}

function FlyTo({ center }) {
  const map = useMap();
  useEffect(() => { if (center) map.flyTo(center, 14); }, [center]);
  return null;
}

export default function LocationPicker({ pickup, destination, onPickupChange, onDestinationChange }) {
  const [mode, setMode] = useState('pickup');
  const center = pickup?.lat ? [pickup.lat, pickup.lng] : [19.076, 72.877];

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      onPickupChange(pos.coords.latitude, pos.coords.longitude);
    });
  };

  return (
    <div className="location-picker">
      <div className="picker-controls">
        <button type="button" className={`picker-btn ${mode === 'pickup' ? 'active-pickup' : ''}`}
          onClick={() => setMode('pickup')}>
          📍 Set Pickup
        </button>
        <button type="button" className={`picker-btn ${mode === 'destination' ? 'active-dest' : ''}`}
          onClick={() => setMode('destination')}>
          🏁 Set Destination
        </button>
        <button type="button" className="picker-btn" onClick={useMyLocation}>
          📡 My Location
        </button>
      </div>

      <div className="map-container">
        <MapContainer center={center} zoom={13} style={{ height: '250px', width: '100%', borderRadius: '8px' }}>
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler
            mode={mode}
            onPickup={(lat, lng) => onPickupChange(lat, lng)}
            onDestination={(lat, lng) => onDestinationChange(lat, lng)}
          />
          {pickup?.lat && <Marker position={[pickup.lat, pickup.lng]} />}
          {destination?.lat && <Marker position={[destination.lat, destination.lng]} icon={greenIcon} />}
          <FlyTo center={pickup?.lat ? [pickup.lat, pickup.lng] : null} />
        </MapContainer>
      </div>

      <div className="location-info">
        <p>📍 Pickup: {pickup?.lat ? `${pickup.lat.toFixed(4)}, ${pickup.lng.toFixed(4)}` : 'Click map or use My Location'}</p>
        <p>🏁 Dest: {destination?.lat ? `${destination.lat.toFixed(4)}, ${destination.lng.toFixed(4)}` : 'Click map to set'}</p>
      </div>
    </div>
  );
}
