const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080/v1';

function getToken(role) {
  return localStorage.getItem(`${role}Token`);
}

async function request(path, options = {}, role = null) {
  const headers = { 'Content-Type': 'application/json' };
  const token = role ? getToken(role) : (getToken('rider') || getToken('driver'));
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { headers, ...options });

  // Handle expired/invalid token — force logout
  if (res.status === 401) {
    console.warn('Token expired or invalid, clearing session');
    ['rider', 'riderRide', 'riderTrip', 'riderPayment', 'riderDriverInfo', 'riderLogs', 'riderToken',
     'driver', 'driverOnline', 'driverToken'].forEach(k => localStorage.removeItem(k));
    window.location.reload();
    return { success: false, error: { message: 'Session expired. Please login again.' } };
  }

  return res.json();
}

export const api = {
  // Auth
  createRider: (data) => request('/riders', { method: 'POST', body: JSON.stringify(data) }),
  createDriver: (data) => request('/drivers', { method: 'POST', body: JSON.stringify(data) }),
  lookupRider: (phone) => request(`/riders/lookup?phone=${phone}`),
  lookupDriver: (phone) => request(`/drivers/lookup?phone=${phone}`),

  // Rider endpoints
  getRider: (id) => request(`/riders/${id}`, {}, 'rider'),
  createRide: (data) => request('/rides', { method: 'POST', body: JSON.stringify(data) }, 'rider'),
  getRide: (id) => request(`/rides/${id}`, {}, 'rider'),
  createPayment: (tripId, paymentMethodId) => request('/payments', { method: 'POST', body: JSON.stringify({ tripId, paymentMethodId }) }, 'rider'),
  confirmPayment: (paymentId, razorpayPaymentId) => request(`/payments/${paymentId}/confirm`, { method: 'POST', body: JSON.stringify({ razorpayPaymentId }) }, 'rider'),
  getPaymentByTrip: (tripId) => request(`/payments/by-trip/${tripId}`, {}, 'rider'),

  // Driver endpoints
  getDriver: (id) => request(`/drivers/${id}`, {}, 'driver'),
  updateDriverStatus: (id, statusId) => request(`/drivers/${id}/status`, { method: 'POST', body: JSON.stringify({ statusId }) }, 'driver'),
  updateDriverLocation: (id, lat, lng) => request(`/drivers/${id}/location`, { method: 'POST', body: JSON.stringify({ lat, lng }) }, 'driver'),
  acceptRide: (driverId, rideId) => request(`/drivers/${driverId}/accept`, { method: 'POST', body: JSON.stringify({ rideId }) }, 'driver'),
  getActiveRide: (driverId) => request(`/drivers/${driverId}/active-ride`, {}, 'driver'),
  getDriverEarnings: (driverId) => request(`/drivers/${driverId}/earnings`, {}, 'driver'),
  getAvailableRides: (vehicleTypeId) => request(`/rides/available?vehicleTypeId=${vehicleTypeId}`),
  estimateFare: (pickupLat, pickupLng, destLat, destLng, vehicleTypeId) =>
    request(`/rides/estimate?pickupLat=${pickupLat}&pickupLng=${pickupLng}&destLat=${destLat}&destLng=${destLng}&vehicleTypeId=${vehicleTypeId}`),

  // Shared
  getTripByRide: (rideId) => request(`/trips/by-ride/${rideId}`),
  endTrip: (tripId, endLat, endLng) => request(`/trips/${tripId}/end`, { method: 'POST', body: JSON.stringify({ endLat, endLng }) }, 'driver'),
  cancelRide: (rideId, riderId) => request(`/rides/${rideId}/cancel`, { method: 'POST', body: JSON.stringify({ riderId }) }, 'rider'),
  getDriver: (id) => request(`/drivers/${id}`, {}, 'driver'),
  updateVehicleType: (driverId, vehicleTypeId, licensePlate) => request(`/drivers/${driverId}/vehicle`, { method: 'POST', body: JSON.stringify({ vehicleTypeId, licensePlate }) }, 'driver'),
};
