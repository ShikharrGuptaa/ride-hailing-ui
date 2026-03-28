const BASE = 'http://localhost:8080/v1';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

export const api = {
  createRider: (data) => request('/riders', { method: 'POST', body: JSON.stringify(data) }),
  getRider: (id) => request(`/riders/${id}`),

  createDriver: (data) => request('/drivers', { method: 'POST', body: JSON.stringify(data) }),
  getDriver: (id) => request(`/drivers/${id}`),
  updateDriverStatus: (id, statusId) => request(`/drivers/${id}/status`, { method: 'POST', body: JSON.stringify({ statusId }) }),
  updateDriverLocation: (id, lat, lng) => request(`/drivers/${id}/location`, { method: 'POST', body: JSON.stringify({ lat, lng }) }),

  createRide: (data) => request('/rides', { method: 'POST', body: JSON.stringify(data) }),
  getRide: (id) => request(`/rides/${id}`),

  acceptRide: (driverId, rideId) => request(`/drivers/${driverId}/accept`, { method: 'POST', body: JSON.stringify({ rideId }) }),
  getActiveRide: (driverId) => request(`/drivers/${driverId}/active-ride`),
  getAvailableRides: (vehicleTypeId) => request(`/rides/available?vehicleTypeId=${vehicleTypeId}`),

  getTripByRide: (rideId) => request(`/trips/by-ride/${rideId}`),
  endTrip: (tripId, endLat, endLng) => request(`/trips/${tripId}/end`, { method: 'POST', body: JSON.stringify({ endLat, endLng }) }),

  createPayment: (tripId, paymentMethodId) => request('/payments', { method: 'POST', body: JSON.stringify({ tripId, paymentMethodId }) }),
  confirmPayment: (paymentId, razorpayPaymentId) => request(`/payments/${paymentId}/confirm`, { method: 'POST', body: JSON.stringify({ razorpayPaymentId }) }),
  getPaymentByTrip: (tripId) => request(`/payments/by-trip/${tripId}`),
};
