import {Alert} from '@shipfox/react-ui/alert';
import {Button} from '@shipfox/react-ui/button';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@shipfox/react-ui/modal';

interface IntegrationDeleteConfirmModalProps {
  connectionName: string | undefined;
  open: boolean;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function IntegrationDeleteConfirmModal({
  connectionName,
  open,
  isPending,
  onOpenChange,
  onConfirm,
}: IntegrationDeleteConfirmModalProps) {
  const name = connectionName ?? 'this integration';
  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen) => {
        if (isPending && !nextOpen) return;
        onOpenChange(nextOpen);
      }}
    >
      <ModalContent aria-describedby={undefined}>
        <ModalTitle className="sr-only">Delete integration</ModalTitle>
        <ModalHeader title="Delete integration" showClose={!isPending} />
        <ModalBody className="gap-16">
          <Alert variant="error" animated={false}>
            Are you sure you want to delete <strong>{name}</strong>? Once deleted, Shipfox will
            immediately stop processing events from this integration. This cannot be undone.
          </Alert>
        </ModalBody>
        <ModalFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" variant="danger" isLoading={isPending} onClick={onConfirm}>
            Delete integration
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
