import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';

const RIDE_STATUS = {
  201: 'REQUESTED', 202: 'MATCHING', 203: 'DRIVER_ASSIGNED',
  204: 'DRIVER_ACCEPTED', 205: 'IN_PROGRESS', 206: 'COMPLETED', 207: 'CANCELLED',
};
const TRIP_STATUS = { 301: 'IN_PROGRESS', 302: 'PAUSED', 303: 'COMPLETED' };
const PAYMENT_STATUS = { 401: 'PENDING', 402: 'PROCESSING', 403: 'COMPLETED', 404: 'FAILED' };
const VEHICLE_TYPES = [{ id: 501, label: 'Economy' }, { id: 502, label: 'Premium' }, { id: 503, label: 'SUV' }];
const RAZORPAY_KEY = import.meta.env.VITE_RAZORPAY_KEY || '';

function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }

export default function RiderView() {
  const [rider, setRider] = useState(() => load('rider'));
  const [ride, setRide] = useState(() => load('riderRide'));
  const [trip, setTrip] = useState(() => load('riderTrip'));
  const [payment, setPayment] = useState(() => load('riderPayment'));
  const [logs, setLogs] = useState(() => load('riderLogs') || []);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef(null);

  const [regForm, setRegForm] = useState({ name: '', phone: '', email: '' });
  const [rideForm, setRideForm] = useState({
    pickupLat: 19.076, pickupLng: 72.877,
    destinationLat: 19.100, destinationLng: 72.900,
    vehicleTypeId: 501,
  });

  const addLog = (msg) => {
    setLogs((prev) => {
      const updated = [...prev, `${new Date().toLocaleTimeString()} - ${msg}`];
      save('riderLogs', updated);
      return updated;
    });
  };

  // Persist state changes
  useEffect(() => { if (rider) save('rider', rider); }, [rider]);
  useEffect(() => { save('riderRide', ride); }, [ride]);
  useEffect(() => { save('riderTrip', trip); }, [trip]);
  useEffect(() => { save('riderPayment', payment); }, [payment]);

  // On mount: restore full state from backend
  useEffect(() => {
    if (!ride?.id) return;
    const restore = async () => {
      const rideRes = await api.getRide(ride.id);
      if (rideRes.success) setRide(rideRes.data);

      if (rideRes.data?.status?.id >= 204) {
        const tripRes = await api.getTripByRide(ride.id);
        if (tripRes.success && tripRes.data) {
          setTrip(tripRes.data);
          // Check if payment exists for this trip
          if (tripRes.data.status?.id === 303 && tripRes.data.id) {
            const payRes = await api.getPaymentByTrip(tripRes.data.id);
            if (payRes.success && payRes.data) setPayment(payRes.data);
          }
        }
      }
    };
    restore();
  }, []);

  // Poll ride status
  useEffect(() => {
    if (!ride?.id || ride?.status?.id === 206 || ride?.status?.id === 207) return;
    const poll = async () => {
      const res = await api.getRide(ride.id);
      if (res.success) {
        setRide(res.data);
        if (res.data.status?.id >= 204) {
          const tripRes = await api.getTripByRide(ride.id);
          if (tripRes.success && tripRes.data) setTrip(tripRes.data);
        }
      }
    };
    pollRef.current = setInterval(poll, 2000);
    return () => clearInterval(pollRef.current);
  }, [ride?.id, ride?.status?.id]);

  const register = async (e) => {
    e.preventDefault();
    setLoading(true);
    const res = await api.createRider(regForm);
    if (res.success) {
      localStorage.setItem('riderToken', res.data.token);
      setRider(res.data.user);
      addLog(`Registered as ${res.data.user.name}`);
    }
    else addLog(`Error: ${res.error?.message}`);
    setLoading(false);
  };

  const requestRide = async (e) => {
    e.preventDefault();
    setLoading(true);
    addLog('Requesting ride...');
    const res = await api.createRide({ riderId: rider.id, ...rideForm });
    if (res.success) {
      setRide(res.data);
      addLog(`Ride created! Status: ${RIDE_STATUS[res.data.status?.id]}`);
      if (res.data.driverId) addLog(`Driver matched: ${res.data.driverId?.slice(0, 8)}...`);
    } else addLog(`Error: ${res.error?.message}`);
    setLoading(false);
  };

  const openRazorpay = (paymentData) => {
    if (!RAZORPAY_KEY || !paymentData.pspReference || !window.Razorpay) {
      addLog('Razorpay key not set or order missing.');
      return;
    }
    addLog('Opening Razorpay checkout...');
    const rzp = new window.Razorpay({
      key: RAZORPAY_KEY,
      amount: Math.round(paymentData.amount * 100),
      currency: 'INR',
      name: 'Ride Hailing',
      description: 'Ride fare',
      order_id: paymentData.pspReference,
      handler: async (response) => {
        addLog(`Payment success: ${response.razorpay_payment_id}`);
        const confirmRes = await api.confirmPayment(paymentData.id, response.razorpay_payment_id);
        if (confirmRes.success) {
          setPayment(confirmRes.data);
          addLog('Payment confirmed!');
        }
      },
      prefill: { name: rider?.name, email: rider?.email, contact: rider?.phone },
      theme: { color: '#3b82f6' },
    });
    rzp.on('payment.failed', (r) => addLog(`Payment failed: ${r.error.description}`));
    rzp.open();
  };

  const makePayment = async () => {
    if (!trip) return;
    setLoading(true);
    addLog('Creating payment order...');
    const res = await api.createPayment(trip.id, 601);
    if (!res.success) { addLog(`Error: ${res.error?.message}`); setLoading(false); return; }

    const paymentData = res.data;
    setPayment(paymentData);
    addLog(`Razorpay order: ${paymentData.pspReference}`);

    if (paymentData.status?.id === 401) {
      openRazorpay(paymentData);
    } else {
      addLog(`Payment already ${PAYMENT_STATUS[paymentData.status?.id]}`);
    }
    setLoading(false);
  };

  const newRide = () => {
    setRide(null); setTrip(null); setPayment(null);
    save('riderRide', null); save('riderTrip', null); save('riderPayment', null);
    addLog('Ready for a new ride.');
  };

  const logout = () => {
    ['rider', 'riderRide', 'riderTrip', 'riderPayment', 'riderLogs', 'riderToken'].forEach(k => localStorage.removeItem(k));
    setRider(null); setRide(null); setTrip(null); setPayment(null); setLogs([]);
  };

  if (!rider) {
    return (
      <div className="panel">
        <h2>👤 Rider Registration</h2>
        <form onSubmit={register}>
          <input type="text" placeholder="Name" required value={regForm.name}
            onChange={(e) => setRegForm({ ...regForm, name: e.target.value })} />
          <input type="tel" placeholder="Phone (10 digits)" required pattern="[6-9][0-9]{9}" maxLength={10}
            value={regForm.phone} onChange={(e) => setRegForm({ ...regForm, phone: e.target.value })} />
          <input type="email" placeholder="Email" value={regForm.email}
            onChange={(e) => setRegForm({ ...regForm, email: e.target.value })} />
          <button type="submit" disabled={loading}>{loading ? 'Registering...' : 'Register'}</button>
        </form>
      </div>
    );
  }

  const isRideComplete = ride?.status?.id === 206;
  const isPaymentDone = payment?.status?.id === 403;

  return (
    <div className="panel">
      <div className="user-bar">👤 {rider.name} ({rider.phone})
        <button className="btn-small" onClick={logout}>Logout</button>
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <h3>🚗 Ride</h3>
          {ride ? (
            <>
              <div className={`status-badge status-${ride.status?.id}`}>{RIDE_STATUS[ride.status?.id]}</div>
              <p>Est. Fare: ₹{ride.estimatedFare}</p>
              {ride.driverId && <p>Driver assigned ✅</p>}
              {ride.status?.id === 204 && <p>Driver on the way 🚗</p>}
              {isRideComplete && isPaymentDone && (
                <button onClick={newRide} className="btn-accept" style={{marginTop: 12}}>🆕 New Ride</button>
              )}
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
              <button type="submit" disabled={loading}>🚗 Request Ride</button>
            </form>
          )}
        </div>

        <div className="card">
          <h3>📍 Trip</h3>
          {trip ? (
            <>
              <div className={`status-badge trip-${trip.status?.id}`}>{TRIP_STATUS[trip.status?.id]}</div>
              {trip.totalFare && <p>Fare: ₹{trip.totalFare}</p>}
              {trip.distanceKm && <p>Distance: {trip.distanceKm} km</p>}
            </>
          ) : <p className="muted">Waiting...</p>}
        </div>

        <div className="card">
          <h3>💳 Payment</h3>
          {payment ? (
            <>
              <div className={`status-badge payment-${payment.status?.id}`}>{PAYMENT_STATUS[payment.status?.id]}</div>
              <p>₹{payment.amount}</p>
              {payment.status?.id === 401 && (
                <button onClick={() => openRazorpay(payment)} disabled={loading} className="btn-pay" style={{marginTop: 8}}>
                  💳 Complete Payment
                </button>
              )}
            </>
          ) : trip?.status?.id === 303 ? (
            <button onClick={makePayment} disabled={loading} className="btn-pay">💳 Pay via Razorpay</button>
          ) : <p className="muted">No payment yet</p>}
        </div>
      </div>

      <div className="log-panel">
        <h3>📋 Live Updates</h3>
        <div className="log-entries">
          {[...logs].reverse().map((l, i) => <div key={i} className="log-entry">{l}</div>)}
          {logs.length === 0 && <p className="muted">Request a ride to start.</p>}
        </div>
      </div>
    </div>
  );
}
