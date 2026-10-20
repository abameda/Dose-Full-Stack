import { AUDIT_READER_ROLES, ORDER_READER_ROLES, type Role, type Staff } from '@dose/contract';
import { useMemo } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router';
import { createAdminApi, type AdminApi } from './api';
import { useLoad } from './hooks';
import { fill, s } from './i18n';
import { LoadGate } from './parts';
import { Audit } from './routes/Audit';
import { OrderDetail } from './routes/OrderDetail';
import { Orders } from './routes/Orders';
import { Today } from './routes/Today';

/** Where the Worker serves the admin; every link and route below is relative to it. */
export const ADMIN_BASENAME = '/admin';

const may = (allowed: readonly Role[], role: Role): boolean => allowed.includes(role);

/**
 * The admin, mounted at `/admin` by the web app (`client:only="react"`). Who may open it is
 * decided before this code is even served (the page guard) and what each person may do by the
 * API; what this app does is show only the pages and buttons a role can use.
 */
export function AdminApp() {
  const api = useMemo(() => createAdminApi(), []);
  return (
    <BrowserRouter basename={ADMIN_BASENAME}>
      <AdminRoutes api={api} />
    </BrowserRouter>
  );
}

/** The admin's frame and pages, inside whatever router the caller provides (tests use a memory router). */
export function AdminRoutes({ api }: { api: AdminApi }) {
  const { state, reload } = useLoad(() => api.me(), 'me');
  return (
    <div className="admin-shell">
      <LoadGate state={state} retry={() => void reload()}>
        {(staff) => <Signed api={api} staff={staff} />}
      </LoadGate>
    </div>
  );
}

function Signed({ api, staff }: { api: AdminApi; staff: Staff }) {
  const readsOrders = may(ORDER_READER_ROLES, staff.role);
  return (
    <>
      <a className="admin-skip" href="#main">
        {s.skipToContent}
      </a>
      <header className="admin-header">
        <p className="admin-brand">{s.brand}</p>
        <p className="admin-who">{fill(s.signedInAs, { name: staff.name, role: s.roleNames[staff.role] })}</p>
        {readsOrders ? (
          <nav aria-label={s.navLabel}>
            <NavLink to="/" end>
              {s.navToday}
            </NavLink>
            <NavLink to="/orders">{s.navOrders}</NavLink>
            {may(AUDIT_READER_ROLES, staff.role) ? <NavLink to="/audit">{s.navAudit}</NavLink> : null}
          </nav>
        ) : null}
      </header>
      <main id="main" className="admin-main">
        {readsOrders ? (
          <Routes>
            <Route index element={<Today api={api} />} />
            <Route path="orders" element={<Orders api={api} />} />
            <Route path="orders/:number" element={<OrderDetail api={api} staff={staff} />} />
            <Route path="audit" element={<Audit api={api} staff={staff} />} />
            <Route path="*" element={<p>{s.pageNotFound}</p>} />
          </Routes>
        ) : (
          <p>{s.noPagesForRole}</p>
        )}
      </main>
    </>
  );
}
