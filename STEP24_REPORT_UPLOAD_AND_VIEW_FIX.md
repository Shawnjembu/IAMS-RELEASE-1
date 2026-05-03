# Step 24: Report Upload and Supervisor File Viewing Fix

Run `supabase_step24_storage_report_upload_patch.sql` in Supabase SQL Editor before testing uploads.

## Fixed

- Student report/logbook uploads now use the private `iams-attachments` Supabase Storage bucket.
- The upload API auto-checks/creates the bucket when possible and validates file type/size.
- Student reports store the private storage path, not an expired URL.
- University supervisors receive fresh signed view links when opening Reports & Visits.
- Logbook attachment links are also generated fresh for assigned university supervisors.
- If upload fails, the report is not silently submitted without the selected file.
- Graded/reviewed reports are locked on the student page to avoid repeated 409 conflicts.
- CSP now allows jsDelivr source-map connections, removing the sourcemap console block.

## Notes

The `chrome-extension://invalid` console messages come from a browser extension, not this project.
Use Incognito mode or disable extensions if you want a clean console while presenting.
