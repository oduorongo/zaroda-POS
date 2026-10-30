# C6 — Labour Payroll & External Portal

Specs: 01 (sections 8, 9), 02 (external roles), 04 (KRA payroll deductions, data protection).
Build:
1. Payroll run from muster roll for a period; deductions from con_tax_settings (rates by effective date, nothing hard-coded).
2. Approval (creator ≠ approver) → pay via EXISTING M-Pesa Daraja integration (B2C) or mark cash; payslip by SMS.
3. External portal (separate login view, same auth): client, consultants and subcontractors see ONLY their projects.
   - Client: progress, milestones, photos, IPCs.
   - Client's QS: certify valuations. Client's Architect: issue instructions, approve variations.
   - Subcontractor: submit and view own valuations/payments.
4. Never expose worker personal data or internal costs on the portal.
Write tests proving an external user cannot read another project's data. Finish: migration, seed portal users, CHANGELOG.
