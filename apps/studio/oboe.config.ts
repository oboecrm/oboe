import { defineConfig, defineModule } from "@oboe/core";

export default defineConfig({
  admin: {
    views: {
      composer: {
        component: "activity-composer",
        label: "Activity Composer",
        path: "/composer",
      },
      timeline: {
        component: "timeline-view",
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
                component: "pipeline-view",
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
});
