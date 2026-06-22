export class EmailTemplateError extends Error {
  readonly templateName: string;

  constructor(templateName: string, message: string, options?: {cause?: unknown}) {
    super(message, options);
    this.name = 'EmailTemplateError';
    this.templateName = templateName;
  }
}
