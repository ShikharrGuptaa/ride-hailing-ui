import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';

const RIDE_STATUS = {
  201: 'REQUESTED', 203: 'DRIVER_ASSIGNED', 204: 'DRIVER_ACCEPTED', 206: 'COMPLETED',
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
  const pollRef = useRef(null);

  const [regForm, setRegForm] = useState({ name: '', phone: '', vehicleTypeId: 501, licensePlate: '' });
  const [location, setLocation] = useState({ lat: 19.076, lng: 72.877 });

  const addLog = (msg) => setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);

  // Persist to localStorage
  useEffect(() => { if (driver) localStorage.setItem('driver', JSON.stringify(driver)); }, [driver]);
  useEffect(() => { localStorage.setItem('driverOnline', isOnline.toString()); }, [isOnline]);

  // Re-sync driver status on mount
  useEffect(() => {
    if (!driver?.id || !isOnline) return;
    const resync = async () => {
      // Re-set online status and location in backend
      await api.updateDriverStatus(driver.id, 101);
      await api.updateDriverLocation(driver.id, location.lat, location.lng);
      addLog('Reconnected - online');
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
    pollRef.current = setInterval(poll, 3000);
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
    addLog(`Online at (${location.lat}, ${location.lng})`);
    setLoading(false);
  };

  const goOffline = async () => {
    setLoading(true);
    await api.updateDriverStatus(driver.id, 102);
    setIsOnline(false);
    addLog('Went offline');
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
    const res = await api.endTrip(trip.id, 19.100, 72.900);
    if (res.success) {
      setTrip(res.data);
      addLog(`Trip ended! Fare: ₹${res.data.totalFare}`);
      setAssignedRide(null);
      setIsOnline(true);
    } else addLog(`Error: ${res.error?.message}`);
    setLoading(false);
  };

  // Allow driver to manually enter a ride ID to accept (simulating push notification)
  const [manualRideId, setManualRideId] = useState('');
  const loadRide = async () => {
    if (!manualRideId) return;
    const res = await api.getRide(manualRideId);
    if (res.success) {
      setAssignedRide(res.data);
      addLog(`Loaded ride: ${RIDE_STATUS[res.data.status?.id]}`);
    } else addLog(`Error: ${res.error?.message}`);
  };

  if (!driver) {
    return (
      <div className="panel">
        <h2>🚗 Driver Registration</h2>
        <form onSubmit={register}>
          <input type="text" placeholder="Name" required value={regForm.name}
            onChange={(e) => setRegForm({ ...regForm, name: e.target.value })} />
          <input type="tel" placeholder="Phone (10 digits)" required pattern="[6-9][0-9]{9}" maxLength={10}
            value={regForm.phone} onChange={(e) => setRegForm({ ...regForm, phone: e.target.value })} />
          <select value={regForm.vehicleTypeId}
            onChange={(e) => setRegForm({ ...regForm, vehicleTypeId: Number(e.target.value) })}>
            {VEHICLE_TYPES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
          <input type="text" placeholder="License Plate" required value={regForm.licensePlate}
            onChange={(e) => setRegForm({ ...regForm, licensePlate: e.target.value })} />
          <button type="submit" disabled={loading}>{loading ? 'Registering...' : 'Register'}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="user-bar">
        🚗 {driver.name} ({driver.phone})
        <span className={`online-dot ${isOnline ? 'online' : 'offline'}`}>
          {isOnline ? '🟢 Online' : '🔴 Offline'}
        </span>
        <button className="btn-small" onClick={() => {
          localStorage.removeItem('driver');
          localStorage.removeItem('driverOnline');
          localStorage.removeItem('driverToken');
          setDriver(null); setIsOnline(false); setAssignedRide(null); setTrip(null); setLogs([]);
        }}>Logout</button>
      </div>

      {!isOnline ? (
        <div className="card">
          <h3>Go Online</h3>
          <div className="form-row">
            <input type="number" step="any" placeholder="Lat" value={location.lat}
              onChange={(e) => setLocation({ ...location, lat: Number(e.target.value) })} />
            <input type="number" step="any" placeholder="Lng" value={location.lng}
              onChange={(e) => setLocation({ ...location, lng: Number(e.target.value) })} />
          </div>
          <button onClick={goOnline} disabled={loading} className="btn-accept">
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
