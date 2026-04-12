import type {
  CollectionConfig,
  CollectionValidationContext,
  OboeDocument,
  OboeRuntime,
} from "@oboe/core";

export const FORM_BUILDER_MODULE_SLUG = "oboe-form-builder";
export const FORM_BUILDER_VIEW_KEY = "builder";
export const FORM_BUILDER_COMPONENT =
  "@oboe/plugin-form-builder#FormBuilderView";

export type FormFieldType =
  | "text"
  | "textarea"
  | "email"
  | "number"
  | "checkbox"
  | "select"
  | "radio"
  | "date"
  | "message";

export interface FormFieldOption {
  label: string;
  value: string;
}

export interface BaseFormFieldDefinition {
  blockType: FormFieldType;
  defaultValue?: boolean | number | string;
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  width?: number;
}

export interface TextFormFieldDefinition extends BaseFormFieldDefinition {
  blockType: "text";
  defaultValue?: string;
}

export interface TextareaFormFieldDefinition extends BaseFormFieldDefinition {
  blockType: "textarea";
  defaultValue?: string;
}

export interface EmailFormFieldDefinition extends BaseFormFieldDefinition {
  blockType: "email";
  defaultValue?: string;
}

export interface NumberFormFieldDefinition extends BaseFormFieldDefinition {
  blockType: "number";
  defaultValue?: number;
}

export interface CheckboxFormFieldDefinition extends BaseFormFieldDefinition {
  blockType: "checkbox";
  defaultValue?: boolean;
}

export interface DateFormFieldDefinition extends BaseFormFieldDefinition {
  blockType: "date";
  defaultValue?: string;
}

export interface MessageFormFieldDefinition extends BaseFormFieldDefinition {
  blockType: "message";
  message: string;
}

export interface SelectLikeFormFieldDefinition extends BaseFormFieldDefinition {
  defaultValue?: string;
  options: FormFieldOption[];
}

export interface SelectFormFieldDefinition
  extends SelectLikeFormFieldDefinition {
  blockType: "select";
}

export interface RadioFormFieldDefinition
  extends SelectLikeFormFieldDefinition {
  blockType: "radio";
}

export type FormFieldDefinition =
  | CheckboxFormFieldDefinition
  | DateFormFieldDefinition
  | EmailFormFieldDefinition
  | MessageFormFieldDefinition
  | NumberFormFieldDefinition
  | RadioFormFieldDefinition
  | SelectFormFieldDefinition
  | TextareaFormFieldDefinition
  | TextFormFieldDefinition;

export interface FormEmailDefinition {
  bcc?: string;
  cc?: string;
  emailFrom?: string;
  emailTo?: string;
  message: string;
  replyTo?: string;
  subject: string;
}

export interface PreparedEmail {
  bcc?: string;
  cc?: string;
  from?: string;
  replyTo?: string;
  subject: string;
  text: string;
  to: string;
}

export interface BeforeEmailContext {
  form: SanitizedFormDocument;
  req: Request;
  runtime: OboeRuntime;
  submissionData: Record<string, unknown>;
}

export interface FormBuilderPluginOptions {
  beforeEmail?: (
    emails: PreparedEmail[],
    context: BeforeEmailContext
  ) => PreparedEmail[] | Promise<PreparedEmail[]>;
  defaultToEmail?: string;
  enabled?: boolean;
  fields?: Partial<Record<FormFieldType, boolean>>;
  formOverrides?: Partial<CollectionConfig>;
  formSlug?: string;
  formSubmissionOverrides?: Partial<CollectionConfig>;
  routeBase?: string;
  submissionSlug?: string;
}

export interface PublicRedirect {
  url: string;
}

export interface PublicFormDocument {
  confirmationMessage?: string;
  confirmationType: "message" | "redirect";
  fields: FormFieldDefinition[];
  id: string;
  redirect?: PublicRedirect;
  slug: string;
  submitButtonLabel?: string;
  title: string;
}

export interface FormBuilderDocumentData {
  confirmationMessage?: string;
  confirmationType: "message" | "redirect";
  emails: FormEmailDefinition[];
  fields: FormFieldDefinition[];
  redirectURL?: string;
  slug: string;
  status: "draft" | "published";
  submitButtonLabel?: string;
  title: string;
}

export interface SanitizedFormDocument extends FormBuilderDocumentData {
  id?: string;
}

export interface FormBuilderCollectionMetadata {
  allowedFieldTypes: FormFieldType[];
  defaultToEmail?: string;
  routeBase: string;
}

export interface FormBuilderCollectionConfig extends CollectionConfig {
  formBuilder?: FormBuilderCollectionMetadata;
}

export interface FormBuilderViewProps {
  basePath?: string;
  collection: CollectionConfig;
  doc?: OboeDocument;
  formAction?: (formData: FormData) => Promise<void> | void;
  metadata?: FormBuilderCollectionMetadata;
}

export interface FormCollectionSchemaContext
  extends CollectionValidationContext {
  collection: CollectionConfig;
}
