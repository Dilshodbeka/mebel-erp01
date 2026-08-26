import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { LoginView } from './components/LoginView';
import { DashboardView } from './components/DashboardView';
import { WorkerTerminalView } from './components/WorkerTerminalView';
import { CRMView } from './components/CRMView';
import { ProductionView } from './components/ProductionView';
import { MonitoringView } from './components/MonitoringView';
import { OrderCalcView } from './components/OrderCalcView';
import { KanbanView } from './components/KanbanView';
import { WarehouseView } from './components/WarehouseView';
import { BlanksCatalogView } from './components/BlanksCatalogView';
import { FinishedCatalogView } from './components/FinishedCatalogView';
import { ServicesView } from './components/ServicesView';
import { LaborCatalogView } from './components/LaborCatalogView';
import { PaintCatalogView } from './components/PaintCatalogView';
import { SandingView } from './components/SandingView';
import { WorkersView } from './components/WorkersView';
import { AnalyticsView } from './components/AnalyticsView';
import { TelegramView } from './components/TelegramView';
import { GlobalSearchModal } from './components/GlobalSearchModal';
import { ToastContainer } from './components/ToastContainer';

const MainLayout: React.FC = () => {
  const { currentUser, currentView } = useApp();

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col justify-center items-center p-4 relative">
        <div className="w-full flex justify-center">
          <LoginView />
        </div>
        <ToastContainer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col selection:bg-blue-600 selection:text-white">
      <Header />

      <main className="flex-1 max-w-[1560px] w-full mx-auto p-4 sm:p-6 lg:p-8">
        {currentView === 'dashboard' && <DashboardView />}
        {currentView === 'worker-terminal' && <WorkerTerminalView />}
        {currentView === 'crm' && <CRMView />}
        {(currentView === 'orders' || (currentView as string) === 'production') && <ProductionView />}
        {(currentView === 'monitor' || (currentView as string) === 'monitoring') && <MonitoringView />}
        {currentView === 'order-calc' && <OrderCalcView />}
        {currentView === 'kanban' && <KanbanView />}
        {currentView === 'warehouse' && <WarehouseView />}
        {currentView === 'blanks' && <BlanksCatalogView />}
        {currentView === 'finished' && <FinishedCatalogView />}
        {currentView === 'services' && <ServicesView />}
        {currentView === 'labor-catalog' && <LaborCatalogView />}
        {(currentView === 'paint-catalog' || currentView === 'paint') && <PaintCatalogView />}
        {currentView === 'sanding' && <SandingView />}
        {currentView === 'workers' && <WorkersView />}
        {(currentView === 'finance' || (currentView as string) === 'analytics') && <AnalyticsView />}
        {currentView === 'telegram' && <TelegramView />}
      </main>

      {/* Global Dossier Search Modal & Notifications */}
      <GlobalSearchModal />
      <ToastContainer />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}
