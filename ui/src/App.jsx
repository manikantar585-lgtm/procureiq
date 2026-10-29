import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  ShellBar, ShellBarItem, ShellBarBranding, Avatar, NavigationLayout, SideNavigation, SideNavigationItem, Popover, List, ListItemStandard, Toast, Button
} from '@ui5/webcomponents-react';
import { setTheme } from '@ui5/webcomponents-base/dist/config/Theme.js';
import { api, setCredentials, PERSONAS } from './api';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Invoices from './pages/Invoices.jsx';
import InvoiceDetail from './pages/InvoiceDetail.jsx';
import Upload from './pages/Upload.jsx';
import Copilot from './pages/Copilot.jsx';
import Vendors from './pages/Vendors.jsx';
import SapExplorer from './pages/SapExplorer.jsx';
import Audit from './pages/Audit.jsx';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const NAV = [
  { route: '/overview', text: 'Overview', icon: 'home' },
  { route: '/invoices', text: 'Invoice Inbox', icon: 'documents' },
  { route: '/upload', text: 'Capture Invoice', icon: 'upload-to-cloud' },
  { route: '/copilot', text: 'AI Copilot', icon: 'ai' },
  { route: '/vendors', text: 'Vendor Risk', icon: 'supplier' },
  { route: '/sap', text: 'SAP S/4HANA', icon: 'it-system' },
  { route: '/audit', text: 'Audit Trail', icon: 'history', role: 'Manager' }
];

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem('piq-user') || 'null'); } catch { return null; }
}

export default function App() {
  const [user, setUser] = useState(() => { const u = loadSession(); if (u) setCredentials(u); return u; });
  const [status, setStatus] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [dark, setDark] = useState(false);
  const [toast, setToast] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const notify = useCallback((msg) => setToast({ msg, k: Date.now() }), []);
  const can = useCallback((role) => !!user?.roles.includes(role), [user]);

  useEffect(() => { if (user) api.systemStatus().then(setStatus).catch(() => {}); }, [user]);
  useEffect(() => { setTheme(dark ? 'sap_horizon_dark' : 'sap_horizon'); }, [dark]);

  const login = (key) => {
    const p = PERSONAS[key];
    setCredentials(p);
    sessionStorage.setItem('piq-user', JSON.stringify(p));
    setUser(p);
    navigate('/overview');
  };
  const logout = () => { sessionStorage.removeItem('piq-user'); setCredentials(null); setUser(null); setProfileOpen(false); };

  if (!user) return <Login onLogin={login} />;

  const current = '/' + (location.pathname.split('/')[1] || 'overview');

  return (
    <Ctx.Provider value={{ user, can, notify, status }}>
      <NavigationLayout
        className="app-layout"
        mode={collapsed ? 'Collapsed' : 'Expanded'}
        header={
          <ShellBar
            id="shellbar"
            branding={<ShellBarBranding logo={<img src="/ui/logo.svg" alt="" width="32" height="32" />} onClick={() => navigate('/overview')}>ProcureIQ</ShellBarBranding>}
            secondaryTitle="Accounts Payable Cockpit · Aurora Industries Ltd"
            startButton={<Button icon="menu2" design="Transparent" onClick={() => setCollapsed((c) => !c)} tooltip="Toggle navigation" />}
            profile={<Avatar id="profile-avatar" initials={user.initials} colorScheme="Accent6" />}
            onProfileClick={() => setProfileOpen(true)}
          >
            <ShellBarItem icon="ai" text="Ask Copilot" onClick={() => navigate('/copilot')} />
            <ShellBarItem icon="palette" text={dark ? 'Light theme' : 'Dark theme'} onClick={() => setDark((d) => !d)} />
          </ShellBar>
        }
        sideContent={
          <SideNavigation onSelectionChange={(e) => navigate(e.detail.item.dataset.route)}>
            {NAV.filter((n) => !n.role || can(n.role)).map((n) => (
              <SideNavigationItem key={n.route} text={n.text} icon={n.icon} data-route={n.route} selected={current === n.route} />
            ))}
            <SideNavigationItem slot="fixedItems" text={`${status?.sapMode === 'mock' ? 'S/4HANA (mock)' : 'S/4HANA ' + (status?.sapMode || '')}`} icon="database" data-route="/sap" unselectable />
          </SideNavigation>
        }
      >
        <main className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<Overview />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/invoices/:id" element={<InvoiceDetail />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/copilot" element={<Copilot />} />
            <Route path="/vendors" element={<Vendors />} />
            <Route path="/sap" element={<SapExplorer />} />
            <Route path="/audit" element={can('Manager') ? <Audit /> : <Navigate to="/overview" />} />
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </main>
      </NavigationLayout>

      <Popover opener="profile-avatar" open={profileOpen} onClose={() => setProfileOpen(false)} placement="Bottom" headerText={user.name}>
        <List>
          <ListItemStandard icon="employee" description={user.role}>{user.name}</ListItemStandard>
          {Object.entries(PERSONAS).filter(([, p]) => p.user !== user.user).map(([k, p]) => (
            <ListItemStandard key={k} icon="user-settings" description={p.role} onClick={() => { setProfileOpen(false); login(k); }}>Switch to {p.name}</ListItemStandard>
          ))}
          <ListItemStandard icon="log" onClick={logout}>Sign out</ListItemStandard>
        </List>
      </Popover>
      {toast && <Toast key={toast.k} open duration={4000} onClose={() => setToast(null)}>{toast.msg}</Toast>}
    </Ctx.Provider>
  );
}
