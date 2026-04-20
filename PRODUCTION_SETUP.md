# Production Setup

This project is prepared for a real Firebase deployment, but the first HOD account must be bootstrapped once in the target Firebase project.

## 1. Prerequisites

- Firebase project access for `costflow-ab720`
- Firebase CLI installed and logged in
- Cloud Functions deployment permission
- Real JK Tyre company CIDR ranges

## 2. Install Functions Dependencies

```powershell
cd "g:\Anti gravity Projects\CostingFlow\functions"
npm install
```

## 3. Configure Firebase Runtime Values

Set the allowed office/VPN IP ranges and the one-time bootstrap key.

```powershell
firebase functions:config:set network.allowed_cidrs="10.0.0.0/8,172.16.0.0/12,192.168.0.0/16" setup.key="CHANGE_THIS_TO_A_LONG_RANDOM_SECRET"
```

Replace the CIDRs with the real JK Tyre network ranges.

## 4. Deploy

From the repo root:

```powershell
firebase deploy --only hosting,functions,firestore:rules,firestore:indexes,storage
```

## 5. Bootstrap The First HOD

After deployment, call the one-time bootstrap endpoint:

```powershell
$body = @{
  setupKey = "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET"
  name = "HOD Admin"
  email = "hod@hasetri.com"
  password = "123456"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "https://costflow-ab720.web.app/api/bootstrap-first-hod" `
  -ContentType "application/json" `
  -Body $body
```

What this does:

- Creates the first HOD in Firebase Authentication
- Creates `/users/{uid}` in Firestore
- Assigns HOD custom claims
- Enables normal HOD login and HOD-driven user creation

This endpoint works only when:

- The request comes from an allowed network range
- The correct bootstrap setup key is provided
- No existing HOD user is present yet

## 5A. If The HOD Auth User Already Exists

If you already created the HOD manually in Firebase Authentication and only the Firestore profile is missing, use this endpoint instead:

```powershell
$body = @{
  setupKey = "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET"
  uid = "NsosjHANPSXIGDvG55HEwF8yI8w1"
  name = "HOD Admin"
  email = "hod@hasetri.com"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "https://costflow-ab720.web.app/api/bootstrap-existing-hod" `
  -ContentType "application/json" `
  -Body $body
```

What this does:

- Writes `/users/{uid}` in Firestore for the existing Auth user
- Marks the user as `HOD`
- Adds permissions
- Sets Firebase custom claims
- Enables normal production login and HOD actions

## 6. After Bootstrap

Use the new HOD account to:

- Log in to the website
- Create real Firebase users from the HOD dashboard
- Manage roles, permissions, costing, assignments, approvals, and closure

## 7. Important

- The local development bootstrap account is only for local testing.
- Real production users must come from Firebase Auth + Firestore via deployed backend functions.
- After first HOD bootstrap, keep the setup key secret and rotate/remove it if desired.
