import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { connectWebSocket, subscribe } from '../services/websocket';
import LocationPicker from './LocationPicker';

const RIDE_STATUS = {
  201: 'REQUESTED', 202: 'MATCHING', 203: 'DRIVER_ASSIGNED',
  204: 'DRIVER_ACCEPTED', 205: 'IN_PROGRESS', 206: 'COMPLETED', 207: 'CANCELLED', 208: 'PAYMENT_PENDING',
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
  const [driverInfo, setDriverInfo] = useState(() => load('riderDriverInfo'));
  const [logs, setLogs] = useState(() => load('riderLogs') || []);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef(null);

  const [regForm, setRegForm] = useState({ name: '', phone: '', email: '' });
  const [rideForm, setRideForm] = useState({
    pickupLat: 0, pickupLng: 0,
    destinationLat: 0, destinationLng: 0,
    vehicleTypeId: 501,
  });
  const [fareEstimate, setFareEstimate] = useState(null);

  // Get user's actual location for pickup default
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setRideForm(prev => ({ ...prev, pickupLat: pos.coords.latitude, pickupLng: pos.coords.longitude })),
        () => {} // leave as 0 if denied
      );
    }
  }, []);

  const addLog = (msg) => {
    setLogs((prev) => {
      const updated = [...prev, `${new Date().toLocaleTimeString()} - ${msg}`];
      save('riderLogs', updated);
      return updated;
    });
  };

  // Persist state changes
  useEffect(() => { if (rider) save('rider', rider); }, [rider]);

  // Fetch fare estimate when locations change
  useEffect(() => {
    if (!rideForm.pickupLat || !rideForm.destinationLat) return;
    const fetchEstimate = async () => {
      const res = await api.estimateFare(
        rideForm.pickupLat, rideForm.pickupLng,
        rideForm.destinationLat, rideForm.destinationLng,
        rideForm.vehicleTypeId
      );
      if (res.success) setFareEstimate(res.data);
    };
    fetchEstimate();
  }, [rideForm.pickupLat, rideForm.pickupLng, rideForm.destinationLat, rideForm.destinationLng, rideForm.vehicleTypeId]);
  useEffect(() => { save('riderRide', ride); }, [ride]);
  useEffect(() => { save('riderTrip', trip); }, [trip]);
  useEffect(() => { save('riderPayment', payment); }, [payment]);
  useEffect(() => { save('riderDriverInfo', driverInfo); }, [driverInfo]);

  // Fetch driver info when driver is assigned
  useEffect(() => {
    if (!ride?.driverId || driverInfo?.id === ride.driverId) return;
    const fetchDriver = async () => {
      const res = await api.getDriver(ride.driverId);
      if (res.success) {
        setDriverInfo(res.data);
        addLog(`Driver: ${res.data.name} (${VEHICLE_TYPES.find(v => v.id === res.data.vehicleType?.id)?.label || 'Unknown'})`);
      }
    };
    fetchDriver();
  }, [ride?.driverId]);

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

  // Poll ride status (fallback, stops when completed)
  useEffect(() => {
    if (!ride?.id || ride?.status?.id >= 206) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
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
    pollRef.current = setInterval(poll, 10000);
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

      // Subscribe to real-time ride updates
      connectWebSocket(() => {
        subscribe(`/topic/rides/${res.data.id}`, async (updatedRide) => {
          addLog(`🔔 Ride update: ${RIDE_STATUS[updatedRide.status?.id]}`);
          setRide(updatedRide);
          // Fetch trip when ride is accepted or completed
          if (updatedRide.status?.id >= 204) {
            const tripRes = await api.getTripByRide(updatedRide.id);
            if (tripRes.success && tripRes.data) setTrip(tripRes.data);
          }
        });
      });
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
          // Refresh ride status
          if (ride?.id) {
            const rideRes = await api.getRide(ride.id);
            if (rideRes.success) setRide(rideRes.data);
          }
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
    setRide(null); setTrip(null); setPayment(null); setDriverInfo(null);
    save('riderRide', null); save('riderTrip', null); save('riderPayment', null); save('riderDriverInfo', null);
    addLog('Ready for a new ride.');
  };

  const cancelRide = async () => {
    if (!ride?.id || !rider?.id) return;
    setLoading(true);
    addLog('Cancelling ride...');
    const res = await api.cancelRide(ride.id, rider.id);
    if (res.success) {
      setRide(res.data);
      addLog('Ride cancelled.');
    } else {
      addLog(`Error: ${res.error?.message}`);
    }
    setLoading(false);
  };

  const logout = () => {
    ['rider', 'riderRide', 'riderTrip', 'riderPayment', 'riderDriverInfo', 'riderLogs', 'riderToken'].forEach(k => localStorage.removeItem(k));
    setRider(null); setRide(null); setTrip(null); setPayment(null); setDriverInfo(null); setLogs([]);
  };

  const [phoneInput, setPhoneInput] = useState('');
  const [showFullForm, setShowFullForm] = useState(false);

  const checkPhone = async (e) => {
    e.preventDefault();
    setLoading(true);
    const res = await api.lookupRider(phoneInput);
    if (res.success && res.data) {
      localStorage.setItem('riderToken', res.data.token);
      setRider(res.data.user);
      addLog(`Welcome back, ${res.data.user.name}!`);
    } else {
      setShowFullForm(true);
      setRegForm({ ...regForm, phone: phoneInput });
      addLog('New rider — please complete registration.');
    }
    setLoading(false);
  };

  if (!rider) {
    if (!showFullForm) {
      return (
        <div className="panel">
          <h2>👤 Rider</h2>
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
        <h2>👤 Complete Registration</h2>
        <p className="muted" style={{marginBottom: 12}}>Phone: {regForm.phone}</p>
        <form onSubmit={register}>
          <label className="form-label">Full Name</label>
          <input type="text" placeholder="Enter your name" required value={regForm.name}
            onChange={(e) => setRegForm({ ...regForm, name: e.target.value })} />
          <label className="form-label">Phone Number</label>
          <input type="tel" placeholder="10-digit mobile number" required pattern="[6-9][0-9]{9}" maxLength={10}
            value={regForm.phone} onChange={(e) => setRegForm({ ...regForm, phone: e.target.value })} />
          <label className="form-label">Email (optional)</label>
          <input type="email" placeholder="your@email.com" value={regForm.email}
            onChange={(e) => setRegForm({ ...regForm, email: e.target.value })} />
          <button type="submit" disabled={loading}>{loading ? 'Please wait...' : '→ Continue'}</button>
        </form>
      </div>
    );
  }

  const isRideComplete = ride?.status?.id === 206;
  const isPaymentPending = ride?.status?.id === 208;
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
              {driverInfo && (
                <div style={{marginTop: 8, padding: '8px 12px', background: 'rgba(59,130,246,0.08)', borderRadius: 8}}>
                  <p>🚘 {driverInfo.name}</p>
                  <p style={{fontSize: 13, opacity: 0.8}}>
                    {VEHICLE_TYPES.find(v => v.id === driverInfo.vehicleType?.id)?.label || 'Vehicle'} · {driverInfo.licensePlate || '—'}
                  </p>
                </div>
              )}
              {!driverInfo && ride.driverId && <p>Driver assigned ✅</p>}
              {ride.status?.id === 204 && <p>Driver on the way 🚗</p>}
              {ride.status?.id < 205 && (
                <button onClick={cancelRide} disabled={loading} className="btn-cancel" style={{marginTop: 12}}>
                  ❌ Cancel Ride
                </button>
              )}
              {ride.status?.id === 207 && (
                <button onClick={newRide} className="btn-accept" style={{marginTop: 12}}>🆕 New Ride</button>
              )}
              {isRideComplete && isPaymentDone && (
                <button onClick={newRide} className="btn-accept" style={{marginTop: 12}}>🆕 New Ride</button>
              )}
            </>
          ) : (
            <form onSubmit={requestRide}>
              <LocationPicker
                pickup={{ lat: rideForm.pickupLat, lng: rideForm.pickupLng }}
                destination={{ lat: rideForm.destinationLat, lng: rideForm.destinationLng }}
                onPickupChange={(lat, lng) => setRideForm({ ...rideForm, pickupLat: lat, pickupLng: lng })}
                onDestinationChange={(lat, lng) => setRideForm({ ...rideForm, destinationLat: lat, destinationLng: lng })}
              />
              <label className="form-label">Vehicle Type</label>
              <select value={rideForm.vehicleTypeId}
                onChange={(e) => setRideForm({ ...rideForm, vehicleTypeId: Number(e.target.value) })}>
                {VEHICLE_TYPES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
              <button type="submit" disabled={loading || !rideForm.pickupLat || !rideForm.destinationLat}>
                🚗 Request Ride
              </button>
              {fareEstimate && (
                <div className="fare-estimate">
                  <h4>💰 Fare Estimate</h4>
                  <div className="fare-grid">
                    <span>Base fare</span><span>₹{fareEstimate.baseFare}</span>
                    <span>Distance ({fareEstimate.distanceKm} km)</span><span>₹{fareEstimate.distanceFare}</span>
                    <span>Time ({fareEstimate.durationMin} min)</span><span>₹{fareEstimate.timeFare}</span>
                    {fareEstimate.surgeMultiplier > 1 && (
                      <><span>Surge ({fareEstimate.surgeMultiplier}x)</span><span>Applied</span></>
                    )}
                    <span className="fare-total">Total</span><span className="fare-total">₹{fareEstimate.estimatedFare}</span>
                  </div>
                </div>
              )}
            </form>
          )}
        </div>

        <div className="card">
          <h3>📍 Trip</h3>
          {trip ? (
            <>
              <div className={`status-badge trip-${trip.status?.id}`}>{TRIP_STATUS[trip.status?.id]}</div>
              {trip.totalFare && (
                <div className="fare-grid" style={{marginTop: 8}}>
                  <span>Base</span><span>₹{trip.baseFare}</span>
                  <span>Distance ({trip.distanceKm} km)</span><span>₹{trip.distanceFare}</span>
                  <span>Time ({trip.durationMinutes} min)</span><span>₹{trip.timeFare}</span>
                  <span className="fare-total">Total</span><span className="fare-total">₹{trip.totalFare}</span>
                </div>
              )}
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
          ) : (trip?.status?.id === 303 || isPaymentPending) ? (
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
