import type { Metadata } from 'next';
import { WorkspaceProvider } from '@/components/workspace';
import './globals.css';
import './refresh-resolution.css';
import './refresh-job.css';
import './refresh-other.css';
// The page title is set per page by WorkspaceProvider ("My work – CoSec Workspace").
export const metadata: Metadata = {
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
