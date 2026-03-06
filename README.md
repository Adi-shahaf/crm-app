This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Email Campaign Tracking (by `people.id`)

Campaign delivery state is tracked in `public.peoplemail`, keyed by `people.id`.
This avoids adding per-campaign flags to `people` and keeps CRM list queries fast.

### Table shape

`peoplemail` stores one row per `(person_id, campaign_date)` with:

- `person_id` (FK to `people.id`)
- `email`
- `campaign_date`
- `send_status` (`sent`, `duplicate`, `invalid`)
- `note`

### Typical queries

Get campaign summary:

```sql
select send_status, count(*)
from public.peoplemail
where campaign_date = '2026-03-06'
group by send_status
order by send_status;
```

Get people marked invalid/duplicate for a campaign:

```sql
select pm.person_id, p.full_name, pm.email, pm.send_status
from public.peoplemail pm
join public.people p on p.id = pm.person_id
where pm.campaign_date = '2026-03-06'
  and pm.send_status in ('invalid', 'duplicate');
```

### Performance notes

- `peoplemail` has indexes on `campaign_date`, `person_id`, and `send_status`.
- Keep campaign writes in `peoplemail`; avoid writing campaign flags directly on `people`.
- Query by indexed filters (`campaign_date`, `send_status`) for fast dashboard/reporting lookups.
