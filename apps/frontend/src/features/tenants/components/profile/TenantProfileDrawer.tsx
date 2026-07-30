import { Drawer } from 'vaul';
import { TenantProfilePage } from './TenantProfilePage';

interface Props {
  open: boolean;
  onClose: () => void;
  hostelId: string;
  tenantId: string;
}

/** Mobile drawer wrapper — profile route content in a bottom sheet */
export function TenantProfileDrawer({ open, onClose, hostelId, tenantId }: Props) {
  return (
    <Drawer.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 max-h-[96dvh] rounded-t-2xl bg-background flex flex-col">
          <div className="mx-auto w-12 h-1.5 rounded-full bg-border my-3 shrink-0" />
          <div className="flex-1 overflow-y-auto">
            {open && (
              <TenantProfilePage
                hostelIdProp={hostelId}
                tenantIdProp={tenantId}
                onBack={onClose}
              />
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
