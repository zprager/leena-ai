/**
 * The 10 IT policies — the agent's ONLY authorized knowledge source.
 *
 * Section IDs match the assignment document exactly so citations
 * ("POL-02 §2.3") are stable. Do not paraphrase the text — these strings
 * are what the agent will quote back.
 */

export interface PolicySection {
  id: string; // "1.1"
  text: string;
}

export interface Policy {
  id: string; // "POL-01"
  title: string;
  effective: string; // ISO date
  owner: string;
  sections: PolicySection[];
}

export const POLICIES: Policy[] = [
  {
    id: "POL-01",
    title: "Password & Authentication Policy",
    effective: "2025-09-01",
    owner: "Identity & Access Management team",
    sections: [
      {
        id: "1.1",
        text: "Standard user passwords must be at least 14 characters, contain three of four character classes, and not match any of the previous 12 passwords.",
      },
      {
        id: "1.2",
        text: "Standard accounts rotate passwords annually. Privileged accounts (domain admins, root, DBA) rotate every 90 days.",
      },
      {
        id: "1.3",
        text: "Multi-factor authentication (MFA) is mandatory for every corporate application and is enforced via Okta. Acceptable second factors: Okta Verify push, FIDO2 security key, or TOTP.",
      },
      {
        id: "1.4",
        text: "Accounts are locked after 5 consecutive failed login attempts. Self-service unlock is available after 15 minutes via the password portal; otherwise contact the Service Desk.",
      },
      {
        id: "1.5",
        text: "1Password Enterprise is the sanctioned password manager. Storing corporate credentials in browsers, sticky notes, or personal password managers is prohibited.",
      },
      {
        id: "1.6",
        text: "Privileged users must additionally authenticate with a YubiKey 5 series hardware token. Soft tokens alone do not satisfy privileged access requirements.",
      },
    ],
  },
  {
    id: "POL-02",
    title: "VPN & Remote Access Policy",
    effective: "2025-07-15",
    owner: "Network Security",
    sections: [
      {
        id: "2.1",
        text: "Cisco AnyConnect is the only approved VPN client. Personal VPNs (NordVPN, ExpressVPN, etc.) must not be installed on corporate endpoints.",
      },
      {
        id: "2.2",
        text: "Split tunneling is disabled by policy. All traffic is routed through the corporate gateway and inspected by Zscaler.",
      },
      {
        id: "2.3",
        text: "VPN sessions terminate after 12 hours of connection or 30 minutes of inactivity, whichever comes first.",
      },
      {
        id: "2.4",
        text: "Public or untrusted Wi-Fi (hotels, cafés, airports) is permitted only when AnyConnect is active before any other traffic.",
      },
      {
        id: "2.5",
        text: "Access is geo-restricted to the Approved Country List maintained by Network Security. Connecting from outside the list requires a Travel Exception ticket submitted at least 5 business days in advance.",
      },
      {
        id: "2.6",
        text: "Privileged remote access to production systems is brokered through CyberArk PAM. Direct SSH/RDP to production from a laptop is forbidden.",
      },
    ],
  },
  {
    id: "POL-03",
    title: "Acceptable Use Policy",
    effective: "2025-01-01",
    owner: "Information Security",
    sections: [
      {
        id: "3.1",
        text: "Corporate devices are issued primarily for business use. Incidental personal use is allowed when it does not interfere with work or violate any other policy.",
      },
      {
        id: "3.2",
        text: "Prohibited activities: peer-to-peer file sharing, gambling, adult content, cryptocurrency mining, and any unlicensed streaming.",
      },
      {
        id: "3.3",
        text: "Web traffic is filtered and logged via Zscaler. Logs are retained for 12 months and reviewed only on lawful basis.",
      },
      {
        id: "3.4",
        text: "USB mass storage is blocked by default. Exceptions for business need can be requested via the 'USB Exception' form in ServiceNow with manager approval.",
      },
      {
        id: "3.5",
        text: "Personal cloud storage (Dropbox personal, iCloud Drive, Google Drive consumer) is blocked. Use the corporate Box tenant or OneDrive for Business instead.",
      },
      {
        id: "3.6",
        text: "Corporate devices must remain under the control of the assigned employee. Lending the device to family members or external parties is prohibited.",
      },
    ],
  },
  {
    id: "POL-04",
    title: "Software Installation & Procurement Policy",
    effective: "2025-03-10",
    owner: "IT Procurement",
    sections: [
      {
        id: "4.1",
        text: "Only software listed in the Approved Software Catalog (ServiceNow > Software Center) may be installed without a ticket. End users can self-serve catalog apps.",
      },
      {
        id: "4.2",
        text: "New software requests follow a 5-business-day SLA. Reviews include InfoSec (data classification, telemetry), Procurement (licensing), and Legal (terms of service).",
      },
      {
        id: "4.3",
        text: "Open-source libraries used in internal tools require a Software Bill of Materials (SBOM) and a license review against the Approved License List. GPL and AGPL components require special exception.",
      },
      {
        id: "4.4",
        text: "Corporate email addresses must not be used to sign up for unapproved SaaS free trials or personal accounts.",
      },
      {
        id: "4.5",
        text: "Browser extensions are restricted to the Allowed Extensions List enforced via Chrome and Edge management. Other extensions are blocked at install time.",
      },
      {
        id: "4.6",
        text: "Local admin rights are removed by default. Time-bound admin elevation can be requested through Make-Me-Admin for a maximum of 60 minutes per session.",
      },
    ],
  },
  {
    id: "POL-05",
    title: "Data Classification & Handling Policy",
    effective: "2025-04-01",
    owner: "Data Governance",
    sections: [
      {
        id: "5.1",
        text: "Helix data is classified into four tiers: Public, Internal, Confidential, and Restricted. Every document inherits the highest tier of any field it contains.",
      },
      {
        id: "5.2",
        text: "Restricted data (PHI, payment card data, source code for revenue-critical systems) must be encrypted both at rest and in transit, and may only reside in approved geographies (US-East, EU-Central).",
      },
      {
        id: "5.3",
        text: "Confidential data may not be sent to external recipients without a Data Loss Prevention (DLP) exception. The DLP exception process requires data owner approval and is valid for 30 days.",
      },
      {
        id: "5.4",
        text: "EU personal data is subject to GDPR controls; transfer outside the EEA requires Standard Contractual Clauses on file.",
      },
      {
        id: "5.5",
        text: "Retention follows the published Records Retention Schedule. Default for unclassified business records is 7 years; PHI is 10 years; payment data is purged at 13 months.",
      },
      {
        id: "5.6",
        text: "Auto-forwarding corporate email to any external address (including personal Gmail) is technically blocked and policy-prohibited.",
      },
    ],
  },
  {
    id: "POL-06",
    title: "BYOD (Bring Your Own Device) Policy",
    effective: "2025-02-01",
    owner: "Endpoint Engineering",
    sections: [
      {
        id: "6.1",
        text: "Personal devices are permitted for corporate email, calendar, and Teams only. They must be enrolled in Microsoft Intune for MDM management.",
      },
      {
        id: "6.2",
        text: "Enrollment establishes a managed work container. IT can remote-wipe only the corporate container; personal data is not touched.",
      },
      {
        id: "6.3",
        text: "Restricted and Confidential data must never be stored on a BYOD device outside the managed container.",
      },
      {
        id: "6.4",
        text: "Jailbroken or rooted devices are blocked from enrollment and from accessing corporate resources.",
      },
      {
        id: "6.5",
        text: "Operating systems must be within two major versions of current vendor releases. Older OS versions lose access automatically.",
      },
      {
        id: "6.6",
        text: "A $50/month BYOD stipend is available for roles flagged 'mobile-eligible' in Workday. Employees on the stipend forfeit eligibility for a corporate-issued mobile phone.",
      },
    ],
  },
  {
    id: "POL-07",
    title: "Email & Communication Security Policy",
    effective: "2025-06-01",
    owner: "Messaging Security",
    sections: [
      {
        id: "7.1",
        text: "All outbound email is sent over TLS. Recipients whose servers do not support TLS receive a portal-pickup link instead of plaintext mail.",
      },
      {
        id: "7.2",
        text: "Suspicious emails should be reported using the Phish Alert Button in Outlook. Do not forward suspicious emails manually.",
      },
      {
        id: "7.3",
        text: "Every email from an external sender is prefixed with an [EXTERNAL] banner. Treat any 'CEO request' from an [EXTERNAL] address as suspect.",
      },
      {
        id: "7.4",
        text: "Attachments larger than 25 MB are blocked at the gateway. Use Box or OneDrive sharing links for large files.",
      },
      {
        id: "7.5",
        text: "Phishing simulations run monthly. Employees who fail two simulations within 12 months are auto-enrolled in additional training.",
      },
      {
        id: "7.6",
        text: "Auto-forwarding rules to external addresses are blocked at the mailbox level and cannot be created by end users.",
      },
    ],
  },
  {
    id: "POL-08",
    title: "Hardware Request & Asset Management Policy",
    effective: "2025-05-01",
    owner: "IT Asset Management",
    sections: [
      {
        id: "8.1",
        text: "The standard laptop refresh cycle is 36 months. Eligibility is calculated from the asset's first-issue date in the CMDB.",
      },
      {
        id: "8.2",
        text: "New-hire hardware requests must be submitted by the hiring manager at least 10 business days before the employee's start date.",
      },
      {
        id: "8.3",
        text: "Lost or stolen devices must be reported within 24 hours via the 'Lost/Stolen Device' ticket. A police report is required if the device was stolen; the case number must be attached to the ticket.",
      },
      {
        id: "8.4",
        text: "Repairs are performed only at the IT Depot in Austin or by approved third-party vendors (Apple Business Repair, Dell ProSupport). Third-party walk-in repairs are not reimbursable.",
      },
      {
        id: "8.5",
        text: "On offboarding, IT mails a prepaid return kit to the employee's address on file. Devices must be shipped within 5 business days of the last working day.",
      },
      {
        id: "8.6",
        text: "Peripherals (monitor, keyboard, mouse, dock) follow a 5-year refresh and are requested through the Peripheral Catalog.",
      },
    ],
  },
  {
    id: "POL-09",
    title: "Security Incident Reporting Policy",
    effective: "2025-08-01",
    owner: "Security Operations Center (SOC)",
    sections: [
      {
        id: "9.1",
        text: "Suspected security incidents must be reported within 1 hour of discovery to security@helix.example or via the 24/7 SOC hotline at extension 4357 (HELP).",
      },
      {
        id: "9.2",
        text: "If you suspect a compromise, do NOT power off the device. Disconnect it from the network (unplug Ethernet, disable Wi-Fi) and wait for SOC instructions to preserve forensic evidence.",
      },
      {
        id: "9.3",
        text: "Severity tiers: SEV-1 (active breach, customer data at risk), SEV-2 (probable breach or major outage), SEV-3 (contained incident), SEV-4 (informational).",
      },
      {
        id: "9.4",
        text: "An Incident Commander is assigned for SEV-1 and SEV-2 incidents. The IC owns external communication; individual employees must not speak to press or customers about the incident.",
      },
      {
        id: "9.5",
        text: "Tabletop exercises are mandatory quarterly for all employees in roles tagged 'incident-responder' in Workday.",
      },
      {
        id: "9.6",
        text: "Lost or stolen devices that are confirmed to contain Restricted data are automatically escalated to a SEV-2 incident.",
      },
    ],
  },
  {
    id: "POL-10",
    title: "Access Provisioning & Deprovisioning Policy",
    effective: "2025-01-15",
    owner: "Identity & Access Management",
    sections: [
      {
        id: "10.1",
        text: "New hires receive access based on the role-based access (RBAC) template attached to their Workday job code at the time HR marks them 'active'.",
      },
      {
        id: "10.2",
        text: "Any access beyond the default RBAC template requires manager approval plus, for Restricted-tier systems, data owner approval.",
      },
      {
        id: "10.3",
        text: "Access reviews are run quarterly. Reviewers have 14 calendar days to certify or revoke entitlements; un-certified access is automatically revoked.",
      },
      {
        id: "10.4",
        text: "On termination or resignation, all access is revoked within 1 hour of HR triggering the 'separation' event in Workday.",
      },
      {
        id: "10.5",
        text: "Contractor accounts have a maximum 6-month duration and require manager renewal. Unrenewed accounts disable automatically.",
      },
      {
        id: "10.6",
        text: "Shared accounts are prohibited. Exceptions are limited to service accounts owned by a named engineering team with rotating credentials in CyberArk.",
      },
    ],
  },
];

/** All sections, flattened into the unit we ingest into the vector store. */
export interface PolicyChunk {
  /** Stable id we use as the Qdrant point id. */
  pointId: number;
  policyId: string;
  policyTitle: string;
  sectionId: string;
  owner: string;
  effective: string;
  /** Embedding input: includes the policy title for retrieval context. */
  embedText: string;
  /** Verbatim section text — what we cite back. */
  text: string;
}

/**
 * Qdrant point ids must be unsigned int OR uuid. We derive a stable numeric id
 * from policy + section: POL-01 §1.4 → 10104.
 */
function pointIdFor(policyId: string, sectionId: string): number {
  const polNum = Number(policyId.split("-")[1]); // 1..10
  const [major, minor] = sectionId.split(".").map(Number);
  return polNum * 10000 + major * 100 + minor;
}

export function allChunks(): PolicyChunk[] {
  return POLICIES.flatMap((p) =>
    p.sections.map<PolicyChunk>((s) => ({
      pointId: pointIdFor(p.id, s.id),
      policyId: p.id,
      policyTitle: p.title,
      sectionId: s.id,
      owner: p.owner,
      effective: p.effective,
      // Including the title in the embedding input gives the model topical
      // context — empirically this beats embedding the section text alone.
      embedText: `${p.id} ${p.title} §${s.id}\n${s.text}`,
      text: s.text,
    })),
  );
}
