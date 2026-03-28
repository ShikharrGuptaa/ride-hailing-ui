import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';

const RIDE_STATUS = {
  201: 'REQUESTED', 202: 'MATCHING', 203: 'DRIVER_ASSIGNED',
  204: 'DRIVER_ACCEPTED', 205: 'IN_PROGRESS', 206: 'COMPLETED', 207: 'CANCELLED',
};
const TRIP_STATUS = { 301: 'IN_PROGRESS', 302: 'PAUSED', 303: 'COMPLETED' };
const PAYMENT_STATUS = { 401: 'PENDING', 402: 'PROCESSING', 403: 'COMPLETED', 404: 'FAILED' };
const VEHICLE_TYPES = [
  { id: 501, label: 'Economy' },
  { id: 502, label: 'Premium' },
  { id: 503, label: 'SUV' },
];

const RAZORPAY_KEY = import.meta.env.VITE_RAZORPAY_KEY || '';

export default function RideDashboard({ rider, driver, rideId: initialRideId, onRideCreated }) {
  const [ride, setRide] = useState(null);
  const [trip, setTrip] = useState(null);
  const [payment, setPayment] = useState(null);
  const [rideId, setRideId] = useState(initialRideId);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef(null);

  const [rideForm, setRideForm] = useState({
    pickupLat: 19.076, pickupLng: 72.877,
    destinationLat: 19.100, destinationLng: 72.900,
    vehicleTypeId: 501,
  });

  const addLog = (msg) => setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);

  useEffect(() => {
    if (!rideId) return;
    const poll = async () => {
      const res = await api.getRide(rideId);
      if (res.success) {
        setRide(res.data);
        if (res.data.status?.id >= 204 && !trip) {
          const tripRes = await api.getTripByRide(rideId);
          if (tripRes.success) setTrip(tripRes.data);
        }
      }
    };
    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => clearInterval(pollRef.current);
  }, [rideId]);

  const requestRide = async (e) => {
    e.preventDefault();
    setLoading(true);
    addLog('Requesting ride...');
    const res = await api.createRide({
      riderId: rider.id,
      ...rideForm,
    });
    if (res.success) {
      setRide(res.data);
      setRideId(res.data.id);
      onRideCreated(res.data.id);
      addLog(`Ride created: ${res.data.id?.slice(0, 8)}... | Status: ${RIDE_STATUS[res.data.status?.id]}`);
      if (res.data.driverId) addLog(`Driver auto-matched: ${res.data.driverId?.slice(0, 8)}...`);
    } else {
      addLog(`Error: ${res.error?.message}`);
    }
    setLoading(false);
  };

  const acceptRide = async () => {
    setLoading(true);
    addLog('Driver accepting ride...');
    const res = await api.acceptRide(driver.id, rideId);
    if (res.success) {
      setRide(res.data);
      addLog(`Ride accepted! Status: ${RIDE_STATUS[res.data.status?.id]}`);
      const tripRes = await api.getTripByRide(rideId);
      if (tripRes.success) {
        setTrip(tripRes.data);
        addLog(`Trip started: ${tripRes.data.id?.slice(0, 8)}...`);
      }
    } else {
      addLog(`Error: ${res.error?.message}`);
    }
    setLoading(false);
  };

  const endTrip = async () => {
    if (!trip) return;
    setLoading(true);
    addLog('Ending trip...');
    const res = await api.endTrip(trip.id, rideForm.destinationLat, rideForm.destinationLng);
    if (res.success) {
      setTrip(res.data);
      addLog(`Trip ended! Fare: ₹${res.data.totalFare} | Distance: ${res.data.distanceKm} km`);
      const rideRes = await api.getRide(rideId);
      if (rideRes.success) setRide(rideRes.data);
    } else {
      addLog(`Error: ${res.error?.message}`);
    }
    setLoading(false);
  };

  const makePayment = async () => {
    if (!trip) return;
    setLoading(true);
    addLog('Creating Razorpay order...');
    const res = await api.createPayment(trip.id, 601);
    if (!res.success) {
      addLog(`Error: ${res.error?.message}`);
      setLoading(false);
      return;
    }

    const paymentData = res.data;
    setPayment(paymentData);
    const orderId = paymentData.pspReference;
    addLog(`Razorpay order: ${orderId} | Amount: ₹${paymentData.amount}`);

    if (RAZORPAY_KEY && orderId && window.Razorpay) {
      const options = {
        key: RAZORPAY_KEY,
        amount: Math.round(paymentData.amount * 100),
        currency: 'INR',
        name: 'Ride Hailing',
        description: `Trip ${trip.id?.slice(0, 8)}...`,
        order_id: orderId,
        handler: async (response) => {
          addLog(`Razorpay payment success: ${response.razorpay_payment_id}`);
          addLog('Confirming payment on server...');
          const confirmRes = await api.confirmPayment(paymentData.id, response.razorpay_payment_id);
          if (confirmRes.success) {
            setPayment(confirmRes.data);
            addLog(`Payment confirmed! Status: ${PAYMENT_STATUS[confirmRes.data.status?.id]}`);
          } else {
            addLog(`Confirm error: ${confirmRes.error?.message}`);
          }
        },
        prefill: {
          name: rider.name || '',
          email: rider.email || '',
          contact: rider.phone || '',
        },
        theme: { color: '#3b82f6' },
      };
      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (response) => {
        addLog(`Payment failed: ${response.error.description}`);
      });
      rzp.open();
    } else {
      addLog('Razorpay key not configured. Payment order created but checkout skipped.');
    }
    setLoading(false);
  };

  return (
    <div className="dashboard">
      <div className="dashboard-grid">
        <div className="card">
          <h3>🚗 Ride</h3>
          {ride ? (
            <>
              <div className={`status-badge status-${ride.status?.id}`}>
                {RIDE_STATUS[ride.status?.id]}
              </div>
              <p>ID: <span className="id">{ride.id?.slice(0, 12)}...</span></p>
              <p>Est. Fare: ₹{ride.estimatedFare}</p>
              {ride.driverId && <p>Driver: {ride.driverId?.slice(0, 8)}...</p>}
            </>
          ) : (
            <form onSubmit={requestRide}>
              <div className="form-row">
                <input type="number" step="any" placeholder="Pickup Lat" value={rideForm.pickupLat}
                  onChange={(e) => setRideForm({ ...rideForm, pickupLat: Number(e.target.value) })} />
                <input type="number" step="any" placeholder="Pickup Lng" value={rideForm.pickupLng}
                  onChange={(e) => setRideForm({ ...rideForm, pickupLng: Number(e.target.value) })} />
              </div>
              <div className="form-row">
                <input type="number" step="any" placeholder="Dest Lat" value={rideForm.destinationLat}
                  onChange={(e) => setRideForm({ ...rideForm, destinationLat: Number(e.target.value) })} />
                <input type="number" step="any" placeholder="Dest Lng" value={rideForm.destinationLng}
                  onChange={(e) => setRideForm({ ...rideForm, destinationLng: Number(e.target.value) })} />
              </div>
              <select value={rideForm.vehicleTypeId}
                onChange={(e) => setRideForm({ ...rideForm, vehicleTypeId: Number(e.target.value) })}>
                {VEHICLE_TYPES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
              <button type="submit" disabled={loading}>
                {loading ? 'Requesting...' : '🚗 Request Ride'}
              </button>
            </form>
          )}
        </div>

        <div className="card">
          <h3>📍 Trip</h3>
          {trip ? (
            <>
              <div className={`status-badge trip-${trip.status?.id}`}>
                {TRIP_STATUS[trip.status?.id]}
              </div>
              {trip.totalFare && <p>Fare: ₹{trip.totalFare}</p>}
              {trip.distanceKm && <p>Distance: {trip.distanceKm} km</p>}
              {trip.durationMinutes && <p>Duration: {trip.durationMinutes} min</p>}
              {trip.baseFare && (
                <div className="fare-breakdown">
                  <p>Base: ₹{trip.baseFare}</p>
                  <p>Distance: ₹{trip.distanceFare}</p>
                  <p>Time: ₹{trip.timeFare}</p>
                </div>
              )}
            </>
          ) : (
            <p className="muted">Waiting for trip...</p>
          )}
        </div>

        <div className="card">
          <h3>💳 Payment</h3>
          {payment ? (
            <>
              <div className={`status-badge payment-${payment.status?.id}`}>
                {PAYMENT_STATUS[payment.status?.id]}
              </div>
              <p>Amount: ₹{payment.amount}</p>
              <p>PSP: {payment.pspReference}</p>
            </>
          ) : (
            <p className="muted">No payment yet</p>
          )}
        </div>
      </div>

      <div className="actions">
        {ride?.status?.id === 203 && (
          <button onClick={acceptRide} disabled={loading} className="btn-accept">
            ✅ Driver Accept Ride
          </button>
        )}
        {trip?.status?.id === 301 && (
          <button onClick={endTrip} disabled={loading} className="btn-end">
            🏁 End Trip
          </button>
        )}
        {trip?.status?.id === 303 && !payment && (
          <button onClick={makePayment} disabled={loading} className="btn-pay">
            💳 Pay (UPI via Razorpay)
          </button>
        )}
      </div>

      <div className="log-panel">
        <h3>📋 Live Updates</h3>
        <div className="log-entries">
          {logs.map((log, i) => <div key={i} className="log-entry">{log}</div>)}
          {logs.length === 0 && <p className="muted">No activity yet. Request a ride to start.</p>}
        </div>
      </div>
    </div>
  );
}
