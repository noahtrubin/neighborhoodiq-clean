import NeighborhoodIQ from "../NeighborhoodIQ";
import AuthGate from "../components/AuthGate";
import Logo from "../components/Logo";

// The forecasting tool. Gated: signed-out visitors are redirected to /login and
// never see the dashboard (client-side enforcement via AuthGate). The tool
// starts empty — results load only when the user searches a ZIP.

function DashboardLoading() {
  return (
    <div className="route-loading">
      <span className="route-loading-logo">
        <Logo size={46} />
      </span>
      Loading your dashboard…
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AuthGate mode="redirect" loadingFallback={<DashboardLoading />}>
      <NeighborhoodIQ />
    </AuthGate>
  );
}
