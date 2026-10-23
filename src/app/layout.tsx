import type { Metadata } from 'next';
import { WorkspaceProvider } from '@/components/workspace';
import './globals.css';
export const metadata: Metadata = {
  title: 'CoSec Workspace',
  description: 'Internal company secretarial workbench',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </body>
    </html>
  );
}
