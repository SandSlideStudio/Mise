import type { ReactNode } from 'react';
import { Navigate } from '@tanstack/react-router';
import { useKitchen } from '../api/kitchen.js';
import { ServiceDetail as ServiceDetailScreen } from './ServiceDetail.js';
import { Services as ServicesScreen } from './Services.js';

/**
 * A kitchen on the running list plans no services, so the service pages are
 * not there for it at all: an old bookmark or a typed address lands on Today
 * rather than on a page for a way of working the kitchen has switched off.
 */
function ForServiceKitchens({ children }: { children: ReactNode }) {
  const kitchen = useKitchen();
  if (kitchen.isPending) return null;
  if (kitchen.data?.prepMode === 'running') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function Services() {
  return (
    <ForServiceKitchens>
      <ServicesScreen />
    </ForServiceKitchens>
  );
}

export function ServiceDetail() {
  return (
    <ForServiceKitchens>
      <ServiceDetailScreen />
    </ForServiceKitchens>
  );
}
