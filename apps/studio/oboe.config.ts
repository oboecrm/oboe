import {
  defineConfig,
  defineModule,
  type PluginConfig,
  type StorageServeMode,
} from "@oboe/core";
import { formBuilderPlugin } from "@oboe/plugin-form-builder";
import { azureBlobStorage } from "@oboe/storage-azure-blob";
import { gcsStorage } from "@oboe/storage-gcs";
import { r2Storage } from "@oboe/storage-r2";
import { s3Storage } from "@oboe/storage-s3";
import { vercelBlobStorage } from "@oboe/storage-vercel-blob";

type StudioStorageProvider =
  | "azure-blob"
  | "gcs"
  | "local"
  | "r2"
  | "s3"
  | "vercel-blob";

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `apps/studio storage sample requires ${name} when OBOE_STORAGE_PROVIDER=${storageProvider}.`
    );
  }

  return value;
}

const storageProvider = (process.env.OBOE_STORAGE_PROVIDER ??
  "local") as StudioStorageProvider;
const storagePrefix = process.env.OBOE_STORAGE_PREFIX ?? "media";
const storageServeMode = (process.env.OBOE_STORAGE_SERVE_MODE ??
  "proxy") as StorageServeMode;

function createStoragePlugin(): PluginConfig | undefined {
  const collections = {
    media: {
      prefix: storagePrefix,
      serveMode: storageServeMode,
    },
  } as const;

  switch (storageProvider) {
    case "local":
      return undefined;
    case "s3":
      return s3Storage({
        bucket: requireEnv("S3_BUCKET"),
        collections,
        config: {
          credentials: {
            accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
            secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
          },
          region: requireEnv("S3_REGION"),
        },
      });
    case "r2":
      return r2Storage({
        accountId: requireEnv("CLOUDFLARE_ACCOUNT_ID"),
        bucket: requireEnv("R2_BUCKET"),
        collections,
        config: {
          credentials: {
            accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
            secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
          },
        },
      });
    case "gcs":
      return gcsStorage({
        bucket: requireEnv("GCS_BUCKET"),
        collections,
        config: {
          projectId: process.env.GCP_PROJECT_ID,
        },
      });
    case "vercel-blob":
      return vercelBlobStorage({
        access: process.env.BLOB_ACCESS === "public" ? "public" : "private",
        collections,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
    case "azure-blob":
      return azureBlobStorage({
        accountKey: process.env.AZURE_STORAGE_ACCOUNT_KEY,
        accountName: process.env.AZURE_STORAGE_ACCOUNT_NAME,
        collections,
        connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
        container: requireEnv("AZURE_STORAGE_CONTAINER"),
        sasToken: process.env.AZURE_STORAGE_SAS_TOKEN,
      });
    default:
      throw new Error(`Unsupported OBOE_STORAGE_PROVIDER: ${storageProvider}`);
  }
}

const storagePlugin = createStoragePlugin();

export default defineConfig({
  admin: {
    views: {
      composer: {
        component: "@oboe/admin-next#ActivityComposer",
        label: "Activity Composer",
        path: "/composer",
      },
      timeline: {
        component: "@oboe/admin-next#TimelineView",
        label: "Timeline",
        path: "/timeline",
      },
    },
  },
  auth: {
    collection: "users",
  },
  jobs: {
    retryLimit: 3,
  },
  modules: [
    defineModule({
      collections: [
        {
          admin: {
            defaultColumns: ["name", "email", "company"],
            titleField: "name",
          },
          fields: [
            {
              name: "name",
              required: true,
              type: "text",
            },
            {
              name: "email",
              type: "email",
            },
            {
              name: "company",
              relationTo: "companies",
              type: "relation",
            },
            {
              name: "owner",
              type: "text",
            },
          ],
          labels: {
            plural: "Contacts",
            singular: "Contact",
          },
          slug: "contacts",
        },
        {
          admin: {
            defaultColumns: ["name", "domain"],
            titleField: "name",
          },
          fields: [
            {
              name: "name",
              required: true,
              type: "text",
            },
            {
              name: "domain",
              type: "text",
            },
          ],
          labels: {
            plural: "Companies",
            singular: "Company",
          },
          slug: "companies",
        },
        {
          admin: {
            defaultColumns: ["name", "stage", "owner", "value"],
            titleField: "name",
            views: {
              pipeline: {
                component: "@oboe/admin-next#PipelineView",
                label: "Pipeline",
                path: "/pipeline",
              },
            },
          },
          fields: [
            {
              name: "name",
              required: true,
              type: "text",
            },
            {
              name: "stage",
              type: "select",
              options: [
                {
                  label: "Lead",
                  value: "lead",
                },
                {
                  label: "Qualified",
                  value: "qualified",
                },
                {
                  label: "Proposal",
                  value: "proposal",
                },
                {
                  label: "Won",
                  value: "won",
                },
              ],
            },
            {
              name: "owner",
              type: "text",
            },
            {
              name: "value",
              type: "number",
            },
            {
              name: "company",
              relationTo: "companies",
              type: "relation",
            },
          ],
          labels: {
            plural: "Deals",
            singular: "Deal",
          },
          slug: "deals",
        },
        {
          admin: {
            defaultColumns: ["type", "summary", "contactId"],
            titleField: "summary",
          },
          fields: [
            {
              name: "type",
              type: "text",
            },
            {
              name: "summary",
              type: "textarea",
            },
            {
              name: "contactId",
              relationTo: "contacts",
              type: "relation",
            },
          ],
          labels: {
            plural: "Activities",
            singular: "Activity",
          },
          slug: "activities",
        },
      ],
      label: "CRM",
      slug: "crm",
    }),
    defineModule({
      collections: [
        {
          admin: {
            defaultColumns: ["title"],
            titleField: "title",
          },
          fields: [
            {
              name: "title",
              type: "text",
            },
            {
              name: "alt",
              type: "text",
            },
          ],
          labels: {
            plural: "Media",
            singular: "Media",
          },
          slug: "media",
          upload: {
            maxFileSize: 10 * 1024 * 1024,
            mimeTypes: ["application/pdf", "image/jpeg", "image/png"],
          },
        },
        {
          auth: true,
          fields: [
            {
              name: "email",
              required: true,
              type: "email",
            },
            {
              name: "role",
              type: "text",
            },
          ],
          labels: {
            plural: "Users",
            singular: "User",
          },
          slug: "users",
        },
      ],
      label: "System",
      slug: "system",
    }),
  ],
  plugins: [formBuilderPlugin(), ...(storagePlugin ? [storagePlugin] : [])],
  typescript: {
    outputFile: "./oboe-types.generated.ts",
  },
});
