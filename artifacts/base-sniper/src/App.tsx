/// <reference types="vite/client" />
import LoginGate from './components/LoginGate';
import Dashboard from './components/Dashboard';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function App() {
    return (
        <LoginGate apiUrl={API_URL}>
            <Dashboard apiUrl={API_URL} />
        </LoginGate>
    );
}
