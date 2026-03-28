import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import RiderView from './components/RiderView';
import DriverView from './components/DriverView';
import './App.css';

function Home() {
  return (
    <div className="home">
      <h1>🚗 Ride Hailing</h1>
      <p className="muted">Choose your role</p>
      <div className="role-cards">
        <Link to="/rider" className="role-card">
          <span className="role-icon">👤</span>
          <h2>I'm a Rider</h2>
          <p>Book a ride, track status, pay</p>
        </Link>
        <Link to="/driver" className="role-card">
          <span className="role-icon">🚗</span>
          <h2>I'm a Driver</h2>
          <p>Go online, accept rides, earn</p>
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
        <Route path="/rider" element={<div className="app"><h1><Link to="/" className="back">←</Link> 👤 Rider</h1><RiderView /></div>} />
        <Route path="/driver" element={<div className="app"><h1><Link to="/" className="back">←</Link> 🚗 Driver</h1><DriverView /></div>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
