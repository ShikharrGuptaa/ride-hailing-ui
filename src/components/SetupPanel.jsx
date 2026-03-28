import { useState } from 'react';
import { api } from '../services/api';

export default function SetupPanel({ rider, driver, onRiderCreated, onDriverCreated }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [riderForm, setRiderForm] = useState({ name: '', phone: '', email: '' });
  const [driverForm, setDriverForm] = useState({ name: '', phone: '', vehicleTypeId: 501, licensePlate: '' });

  const VEHICLE_TYPES = [
    { id: 501, label: 'Economy' },
    { id: 502, label: 'Premium' },
    { id: 503, label: 'SUV' },
  ];

  const setupRider = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await api.createRider(riderForm);
    if (res.success) onRiderCreated(res.data);
    else setError(res.error?.message || 'Failed to create rider');
    setLoading(false);
  };

  const setupDriver = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await api.createDriver(driverForm);
    if (!res.success) { setError(res.error?.message); setLoading(false); return; }
    const driverData = res.data;

    await api.updateDriverStatus(driverData.id, 101);
    await api.updateDriverLocation(driverData.id, 19.076, 72.877);

    onDriverCreated({ ...driverData, status: { id: 101 } });
    setLoading(false);
  };

  return (
    <div className="panel">
      <h2>Setup</h2>
      {error && <div className="error">{error}</div>}

      <div className="setup-row">
        <div className="setup-card">
          <h3>👤 Rider</h3>
          {rider ? (
            <div className="info">
              <p>✅ {rider.name}</p>
              <p>📱 {rider.phone}</p>
              <p className="id">{rider.id}</p>
            </div>
          ) : (
            <form onSubmit={setupRider}>
              <input
                type="text" placeholder="Name" required
                value={riderForm.name}
                onChange={(e) => setRiderForm({ ...riderForm, name: e.target.value })}
              />
              <input
                type="tel" placeholder="Phone (10 digits)" required
                pattern="[6-9][0-9]{9}" maxLength={10}
                value={riderForm.phone}
                onChange={(e) => setRiderForm({ ...riderForm, phone: e.target.value })}
              />
              <input
                type="email" placeholder="Email (optional)"
                value={riderForm.email}
                onChange={(e) => setRiderForm({ ...riderForm, email: e.target.value })}
              />
              <button type="submit" disabled={loading}>
                {loading ? 'Creating...' : 'Register Rider'}
              </button>
            </form>
          )}
        </div>

        <div className="setup-card">
          <h3>🚗 Driver</h3>
          {driver ? (
            <div className="info">
              <p>✅ {driver.name}</p>
              <p>📱 {driver.phone}</p>
              <p>🟢 ONLINE</p>
              <p className="id">{driver.id}</p>
            </div>
          ) : (
            <form onSubmit={setupDriver}>
              <input
                type="text" placeholder="Name" required
                value={driverForm.name}
                onChange={(e) => setDriverForm({ ...driverForm, name: e.target.value })}
              />
              <input
                type="tel" placeholder="Phone (10 digits)" required
                pattern="[6-9][0-9]{9}" maxLength={10}
                value={driverForm.phone}
                onChange={(e) => setDriverForm({ ...driverForm, phone: e.target.value })}
              />
              <select
                value={driverForm.vehicleTypeId}
                onChange={(e) => setDriverForm({ ...driverForm, vehicleTypeId: Number(e.target.value) })}
              >
                {VEHICLE_TYPES.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </select>
              <input
                type="text" placeholder="License Plate" required
                value={driverForm.licensePlate}
                onChange={(e) => setDriverForm({ ...driverForm, licensePlate: e.target.value })}
              />
              <button type="submit" disabled={loading || !rider}>
                {!rider ? 'Create rider first' : loading ? 'Creating...' : 'Register Driver'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
