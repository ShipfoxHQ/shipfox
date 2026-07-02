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
import {Text} from '@shipfox/react-ui/typography';

export function DeleteEntryDialog({
  open,
  onOpenChange,
  entryKey,
  isLoading,
  errorMessage,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  entryKey: string;
  isLoading: boolean;
  errorMessage?: string | undefined;
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            Delete <strong>{entryKey}</strong>?
          </ModalTitle>
        </ModalHeader>
        <ModalBody className="gap-16">
          <Text size="sm">
            Workflows that reference <strong>{entryKey}</strong> will fail at their next run.
          </Text>
          {errorMessage ? (
            <Alert variant="error" animated={false}>
              <Text size="sm">{errorMessage}</Text>
            </Alert>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" isLoading={isLoading} onClick={onConfirm}>
            Delete
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
