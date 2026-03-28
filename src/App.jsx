import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import RiderView from './components/RiderView';
import DriverView from './components/DriverView';
import './App.css';

function Home() {
  return (
    <div className="home">
      <h1>🚗 Ride Hailing</h1>
      <p className="muted" style={{ fontSize: '16px', marginBottom: '8px' }}>
        Multi-tenant ride-hailing platform
      </p>
      <p className="muted" style={{ fontSize: '13px' }}>
        Real-time matching • Fare calculation • Razorpay payments
      </p>
      <div className="role-cards">
        <Link to="/rider" className="role-card">
          <span className="role-icon">👤</span>
          <h2>Rider</h2>
          <p>Book rides, track in real-time, pay securely</p>
        </Link>
        <Link to="/driver" className="role-card">
          <span className="role-icon">🚗</span>
          <h2>Driver</h2>
          <p>Go online, accept rides, earn money</p>
        </Link>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/rider" element={
          <div className="app">
            <h1><Link to="/" className="back">←</Link> 👤 Rider</h1>
            <RiderView />
          </div>
        } />
        <Route path="/driver" element={
          <div className="app">
            <h1><Link to="/" className="back">←</Link> 🚗 Driver</h1>
            <DriverView />
          </div>
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
