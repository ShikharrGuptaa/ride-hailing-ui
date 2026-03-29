import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { connectWebSocket, subscribe, disconnect } from '../services/websocket';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const RIDE_STATUS = {
  201: 'REQUESTED', 203: 'DRIVER_ASSIGNED', 204: 'DRIVER_ACCEPTED', 206: 'COMPLETED', 208: 'PAYMENT_PENDING',
};
const TRIP_STATUS = { 301: 'IN_PROGRESS', 303: 'COMPLETED' };
const DRIVER_STATUS = { 101: 'ONLINE', 102: 'OFFLINE', 103: 'ON_TRIP' };
const VEHICLE_TYPES = [{ id: 501, label: 'Economy' }, { id: 502, label: 'Premium' }, { id: 503, label: 'SUV' }];

export default function DriverView() {
  const [driver, setDriver] = useState(() => {
    const saved = localStorage.getItem('driver');
    return saved ? JSON.parse(saved) : null;
  });
  const [isOnline, setIsOnline] = useState(() => {
    return localStorage.getItem('driverOnline') === 'true';
  });
  const [assignedRide, setAssignedRide] = useState(null);
  const [availableRides, setAvailableRides] = useState([]);
  const [trip, setTrip] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [earnings, setEarnings] = useState({ today: 0, total: 0, trips: 0 });
  const pollRef = useRef(null);

  const [regForm, setRegForm] = useState({ name: '', phone: '', vehicleTypeId: 501, licensePlate: '' });
  const [location, setLocation] = useState({ lat: 0, lng: 0 });

  // Get user's actual location on mount
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setLocation({ lat: 19.076, lng: 72.877 }) // fallback to Mumbai
      );
    }
  }, []);

  const addLog = (msg) => setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);

  // Persist to localStorage
  useEffect(() => { if (driver) localStorage.setItem('driver', JSON.stringify(driver)); }, [driver]);
  useEffect(() => { localStorage.setItem('driverOnline', isOnline.toString()); }, [isOnline]);

  // Fetch earnings from backend
  useEffect(() => {
    if (!driver?.id) return;
    const fetchEarnings = async () => {
      const res = await api.getDriverEarnings(driver.id);
      if (res.success && res.data) {
        setEarnings({
          today: parseFloat(res.data.today_earnings) || 0,
          total: parseFloat(res.data.total_earnings) || 0,
          trips: parseInt(res.data.total_trips) || 0,
        });
      }
    };
    fetchEarnings();
  }, [driver?.id, isOnline]);

  // Re-sync driver status on mount
  useEffect(() => {
    if (!driver?.id || !isOnline) return;
    const resync = async () => {
      await api.updateDriverStatus(driver.id, 101);
      await api.updateDriverLocation(driver.id, location.lat, location.lng);
      addLog('Reconnected - online');
      // Re-subscribe to WebSocket topics
      connectWebSocket(() => {
        subscribe('/topic/rides/available', (ride) => {
          setAvailableRides(prev => {
            if (prev.find(r => r.id === ride.id)) return prev;
            return [...prev, ride];
          });
        });
        subscribe(`/topic/drivers/${driver.id}/rides`, (ride) => {
          setAssignedRide(ride);
        });
        subscribe(`/topic/drivers/${driver.id}/payments`, async (payment) => {
          addLog(`💰 Payment received: ₹${payment.amount}`);
          const res = await api.getDriverEarnings(driver.id);
          if (res.success && res.data) {
            setEarnings({
              today: parseFloat(res.data.today_earnings) || 0,
              total: parseFloat(res.data.total_earnings) || 0,
              trips: parseInt(res.data.total_trips) || 0,
            });
          }
        });
      });
    };
    resync();
  }, []);

  // Poll for available rides when online
  useEffect(() => {
    if (!driver?.id || !isOnline) return;
    const poll = async () => {
      try {
        // Check for active trip first
        const activeRes = await api.getActiveRide(driver.id);
        if (activeRes.success && activeRes.data?.id) {
          setAssignedRide(activeRes.data);
          if (activeRes.data.status?.id >= 204) {
            const tripRes = await api.getTripByRide(activeRes.data.id);
            if (tripRes.success && tripRes.data) setTrip(tripRes.data);
          }
          return;
        }
        // No active ride — check for available rides
        const vehicleTypeId = driver.vehicleType?.id || 501;
        const ridesRes = await api.getAvailableRides(vehicleTypeId);
        if (ridesRes.success && ridesRes.data) {
          setAvailableRides(ridesRes.data);
        }
      } catch (e) {
        console.error('Poll error', e);
      }
    };
    poll();
    pollRef.current = setInterval(poll, 10000);
    return () => clearInterval(pollRef.current);
  }, [driver?.id, isOnline]);

  const register = async (e) => {
    e.preventDefault();
    setLoading(true);
    const res = await api.createDriver(regForm);
    if (res.success) {
      localStorage.setItem('driverToken', res.data.token);
      setDriver(res.data.user);
      addLog(`Registered as ${res.data.user.name}`);
    }
    else addLog(`Error: ${res.error?.message}`);
    setLoading(false);
  };

  const goOnline = async () => {
    setLoading(true);
    await api.updateDriverStatus(driver.id, 101);
    await api.updateDriverLocation(driver.id, location.lat, location.lng);
    setIsOnline(true);
    addLog('Online — listening for rides via WebSocket');

    // Connect WebSocket and subscribe to available rides
    connectWebSocket(() => {
      subscribe('/topic/rides/available', (ride) => {
        addLog(`🔔 New ride available! Fare: ₹${ride.estimatedFare}`);
        setAvailableRides(prev => {
          if (prev.find(r => r.id === ride.id)) return prev;
          return [...prev, ride];
        });
      });
      subscribe(`/topic/drivers/${driver.id}/rides`, (ride) => {
        addLog(`📍 Ride update: status ${ride.status?.id}`);
        setAssignedRide(ride);
      });
      subscribe(`/topic/drivers/${driver.id}/payments`, async (payment) => {
        addLog(`💰 Payment received: ₹${payment.amount}`);
        const res = await api.getDriverEarnings(driver.id);
        if (res.success && res.data) {
          setEarnings({
            today: parseFloat(res.data.today_earnings) || 0,
            total: parseFloat(res.data.total_earnings) || 0,
            trips: parseInt(res.data.total_trips) || 0,
          });
        }
      });
    });

    setLoading(false);
  };

  const goOffline = async () => {
    setLoading(true);
    await api.updateDriverStatus(driver.id, 102);
    setIsOnline(false);
    disconnect();
    addLog('Went offline — WebSocket disconnected');
    setLoading(false);
  };

  const acceptRide = async (rideId) => {
    setLoading(true);
    addLog('Accepting ride...');
    const res = await api.acceptRide(driver.id, rideId);
    if (res.success) {
      setAssignedRide(res.data);
      setAvailableRides([]);
      addLog(`Ride accepted! Picking up rider...`);
      const tripRes = await api.getTripByRide(rideId);
      if (tripRes.success) setTrip(tripRes.data);
    } else addLog(`Error: ${res.error?.message}`);
    setLoading(false);
  };

  const endTrip = async () => {
    if (!trip) return;
    setLoading(true);
    addLog('Ending trip...');
    const res = await api.endTrip(trip.id, null, null);
    if (res.success) {
      setTrip(res.data);
      addLog(`Trip ended! Fare: ₹${res.data.totalFare}`);
      // Refresh earnings from backend
      const earningsRes = await api.getDriverEarnings(driver.id);
      if (earningsRes.success && earningsRes.data) {
        setEarnings({
          today: parseFloat(earningsRes.data.today_earnings) || 0,
          total: parseFloat(earningsRes.data.total_earnings) || 0,
          trips: parseInt(earningsRes.data.total_trips) || 0,
        });
      }
      setAssignedRide(null);
      setIsOnline(true);
    } else addLog(`Error: ${res.error?.message}`);
    setLoading(false);
  };

  const [manualRideId, setManualRideId] = useState('');
  const [showVehicleSwitch, setShowVehicleSwitch] = useState(false);
  const [switchForm, setSwitchForm] = useState({
    vehicleTypeId: driver?.vehicleType?.id || 501,
    licensePlate: driver?.licensePlate || ''
  });
  const loadRide = async () => {
    if (!manualRideId) return;
    const res = await api.getRide(manualRideId);
    if (res.success) {
      setAssignedRide(res.data);
      addLog(`Loaded ride: ${RIDE_STATUS[res.data.status?.id]}`);
    } else addLog(`Error: ${res.error?.message}`);
  };

  const switchVehicle = async (e) => {
    e.preventDefault();
    setLoading(true);
    const res = await api.updateVehicleType(driver.id, switchForm.vehicleTypeId, switchForm.licensePlate);
    if (res.success) {
      setDriver(res.data);
      setShowVehicleSwitch(false);
      addLog(`Switched to ${VEHICLE_TYPES.find(v => v.id === switchForm.vehicleTypeId)?.label}`);
    } else addLog(`Error: ${res.error?.message}`);
    setLoading(false);
  };

  const [phoneInput, setPhoneInput] = useState('');
  const [showFullForm, setShowFullForm] = useState(false);

  const checkPhone = async (e) => {
    e.preventDefault();
    setLoading(true);
    const res = await api.lookupDriver(phoneInput);
    if (res.success && res.data) {
      localStorage.setItem('driverToken', res.data.token);
      setDriver(res.data.user);
      addLog(`Welcome back, ${res.data.user.name}!`);
    } else {
      setShowFullForm(true);
      setRegForm({ ...regForm, phone: phoneInput });
      addLog('New driver — please complete registration.');
    }
    setLoading(false);
  };

  if (!driver) {
    if (!showFullForm) {
      return (
        <div className="panel">
          <h2>🚗 Driver</h2>
          <p className="muted" style={{marginBottom: 12}}>Enter your phone number to login or register.</p>
          <form onSubmit={checkPhone}>
            <label className="form-label">Phone Number</label>
            <input type="tel" placeholder="10-digit mobile number" required pattern="[6-9][0-9]{9}" maxLength={10}
              value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} />
            <button type="submit" disabled={loading}>{loading ? 'Checking...' : '→ Continue'}</button>
          </form>
        </div>
      );
    }
    return (
      <div className="panel">
        <h2>🚗 Complete Registration</h2>
        <p className="muted" style={{marginBottom: 12}}>Phone: {regForm.phone}</p>
        <form onSubmit={register}>
          <label className="form-label">Full Name</label>
          <input type="text" placeholder="Enter your name" required value={regForm.name}
            onChange={(e) => setRegForm({ ...regForm, name: e.target.value })} />
          <label className="form-label">Vehicle Type</label>
          <select value={regForm.vehicleTypeId}
            onChange={(e) => setRegForm({ ...regForm, vehicleTypeId: Number(e.target.value) })}>
            {VEHICLE_TYPES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
          <label className="form-label">License Plate</label>
          <input type="text" placeholder="e.g. MH01AB1234" required value={regForm.licensePlate}
            onChange={(e) => setRegForm({ ...regForm, licensePlate: e.target.value })} />
          <button type="submit" disabled={loading}>{loading ? 'Please wait...' : '→ Register'}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="user-bar">
        🚗 {driver.name} ({driver.phone})
        <span style={{fontSize: 12, opacity: 0.7, marginLeft: 4}}>
          · {VEHICLE_TYPES.find(v => v.id === driver.vehicleType?.id)?.label || 'Unknown'} · {driver.licensePlate || '—'}
        </span>
        <span className={`online-dot ${isOnline ? 'online' : 'offline'}`}>
          {isOnline ? '🟢 Online' : '🔴 Offline'}
        </span>
        {!isOnline && (
          <button className="btn-small" onClick={() => { setShowVehicleSwitch(!showVehicleSwitch); setSwitchForm({ vehicleTypeId: driver.vehicleType?.id || 501, licensePlate: driver.licensePlate || '' }); }}>
            🔄 Switch Vehicle
          </button>
        )}
        <button className="btn-small" onClick={() => {
          localStorage.removeItem('driver');
          localStorage.removeItem('driverOnline');
          localStorage.removeItem('driverToken');
          setDriver(null); setIsOnline(false); setAssignedRide(null); setTrip(null); setLogs([]); setEarnings({ today: 0, total: 0, trips: 0 });
        }}>Logout</button>
      </div>

      {showVehicleSwitch && (
        <div className="card" style={{marginBottom: 12}}>
          <h3>🔄 Switch Vehicle</h3>
          <form onSubmit={switchVehicle}>
            <label className="form-label">Vehicle Type</label>
            <select value={switchForm.vehicleTypeId}
              onChange={(e) => setSwitchForm({ ...switchForm, vehicleTypeId: Number(e.target.value) })}>
              {VEHICLE_TYPES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            <label className="form-label">License Plate</label>
            <input type="text" value={switchForm.licensePlate}
              onChange={(e) => setSwitchForm({ ...switchForm, licensePlate: e.target.value })} />
            <button type="submit" disabled={loading}>{loading ? 'Updating...' : '✅ Update'}</button>
          </form>
        </div>
      )}

      <div className="earnings-bar">
        <div className="earning-item">
          <span className="earning-label">Today</span>
          <span className="earning-value">₹{earnings.today.toFixed(0)}</span>
        </div>
        <div className="earning-item">
          <span className="earning-label">Total</span>
          <span className="earning-value">₹{earnings.total.toFixed(0)}</span>
        </div>
        <div className="earning-item">
          <span className="earning-label">Trips</span>
          <span className="earning-value">{earnings.trips}</span>
        </div>
      </div>

      {!isOnline ? (
        <div className="card">
          <h3>Go Online</h3>
          {location.lat ? (
            <>
              <div className="map-container">
                <MapContainer center={[location.lat, location.lng]} zoom={15} style={{ height: '200px', width: '100%', borderRadius: '8px' }}>
                  <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <Marker position={[location.lat, location.lng]} />
                </MapContainer>
              </div>
              <p className="muted" style={{marginBottom: 8}}>📍 Your location detected</p>
            </>
          ) : (
            <p className="muted" style={{marginBottom: 8}}>📡 Detecting your location...</p>
          )}
          <button onClick={goOnline} disabled={loading || !location.lat} className="btn-accept">
            {loading ? 'Going online...' : '🟢 Go Online'}
          </button>
        </div>
      ) : (
        <>
          <div className="actions">
            <button onClick={goOffline} disabled={loading} className="btn-end">🔴 Go Offline</button>
          </div>

          <div className="dashboard-grid">
            <div className="card">
              <h3>📥 Available Rides</h3>
              {assignedRide ? (
                <>
                  <div className={`status-badge status-${assignedRide.status?.id}`}>
                    {RIDE_STATUS[assignedRide.status?.id]}
                  </div>
                  <p>Est. Fare: ₹{assignedRide.estimatedFare}</p>
                  <p className="id">{assignedRide.id?.slice(0, 12)}...</p>
                </>
              ) : availableRides.length > 0 ? (
                <div className="ride-list">
                  {availableRides.map((r) => (
                    <div key={r.id} className="ride-item">
                      <div>
                        <p>₹{r.estimatedFare} est.</p>
                        <p className="id">{r.id?.slice(0, 12)}...</p>
                      </div>
                      <button onClick={() => acceptRide(r.id)} disabled={loading} className="btn-accept">
                        Accept
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">No rides available. Waiting...</p>
              )}
            </div>

            <div className="card">
              <h3>📍 Active Trip</h3>
              {trip ? (
                <>
                  <div className={`status-badge trip-${trip.status?.id}`}>{TRIP_STATUS[trip.status?.id]}</div>
                  {trip.totalFare && <p>Fare: ₹{trip.totalFare}</p>}
                  {trip.distanceKm && <p>Distance: {trip.distanceKm} km</p>}
                  {trip.status?.id === 301 && (
                    <button onClick={endTrip} disabled={loading} className="btn-end" style={{ marginTop: 12 }}>
                      🏁 End Trip
                    </button>
                  )}
                </>
              ) : <p className="muted">No active trip</p>}
            </div>
          </div>
        </>
      )}

      <div className="log-panel">
        <h3>📋 Driver Log</h3>
        <div className="log-entries">
          {[...logs].reverse().map((l, i) => <div key={i} className="log-entry">{l}</div>)}
          {logs.length === 0 && <p className="muted">Go online to start receiving rides.</p>}
        </div>
      </div>
    </div>
  );
}
