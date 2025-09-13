# Tally Pro — Demo

Full-stack web app with:
- Company registration (company email required, phone optional)
- Admin + Employees
- Employee clock in/out + shift report (daily/weekly/monthly) and busy-by-day chart
- IN/OUT entries per user, daily/weekly/monthly reports
- Monthly extra expenditures (subtract from profit/holdings)
- CSV exports
- Cloud deploy (Render backend + Vercel/Netlify frontend)

## Local run
1) Terminal A:
   cd server
   npm install
   npm start
   # runs http://localhost:4000

2) Open client/index.html in your browser (or serve with any static server).
   Set API (top-right) to http://localhost:4000 if needed.

## Deploy
- Backend: Render using render.yaml (persistent disk stores tally.db)
- Frontend: Vercel (vercel.json) or Netlify (netlify.toml)
- After deploy, open the frontend and set the API (top-right) to your Render URL.

## First-time flow
- Register company: company email required, phone optional.
- Add employees (admin only).
- Employees: Clock In/Out and add IN/OUT entries.
- Reports: Summary/Employee/Category + Monthly extras.

Generated on 2025-09-13T14:54:52.599751Z
# Tally-Pro
