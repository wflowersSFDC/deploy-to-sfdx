import { createRoot } from 'react-dom/client';
import App from './App';
import '@salesforce-ux/design-system/assets/styles/salesforce-lightning-design-system.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
