import argparse
import json
from pathlib import Path

import firebase_admin
from firebase_admin import auth, credentials, firestore


DEFAULT_PERMISSIONS = {
    "viewCosting": True,
    "editCosting": True,
    "approveReports": True,
    "accessAllDepartments": True,
    "manageUsers": True,
    "manageAssignments": True,
    "manageCommercial": True,
    "manageAuditLogs": True,
    "submitRequests": True,
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Bootstrap an existing Firebase Auth user as HOD in Firestore and custom claims.",
    )
    parser.add_argument(
        "--service-account",
        required=True,
        help="Absolute path to Firebase service account JSON.",
    )
    parser.add_argument(
        "--uid",
        required=True,
        help="Firebase Authentication UID to bootstrap.",
    )
    parser.add_argument(
        "--email",
        required=True,
        help="Email for the HOD account.",
    )
    parser.add_argument(
        "--name",
        default="HOD Admin",
        help="Display name for the HOD account.",
    )
    parser.add_argument(
        "--department",
        default="VDD",
        help="Department value to store. Default: VDD",
    )
    parser.add_argument(
        "--project-id",
        default="",
        help="Optional Firebase project ID override.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the payload without writing to Firebase.",
    )
    return parser.parse_args()


def initialize_admin(service_account_path, project_id):
    credential = credentials.Certificate(service_account_path)
    options = {"projectId": project_id} if project_id else None
    return firebase_admin.initialize_app(credential, options)


def build_profile(name, email, department):
    return {
        "name": name,
        "email": email,
        "department": department,
        "role": "HOD",
        "status": "Active",
        "permissions": DEFAULT_PERMISSIONS,
        "createdByUid": "python-bootstrap",
        "createdByName": "Python Bootstrap",
        "updatedByUid": "python-bootstrap",
        "updatedByName": "Python Bootstrap",
    }


def main():
    args = parse_args()
    service_account_path = Path(args.service_account).resolve()
    if not service_account_path.exists():
        raise FileNotFoundError(f"Service account file not found: {service_account_path}")

    profile = build_profile(
        name=args.name.strip(),
        email=args.email.strip().lower(),
        department=args.department.strip(),
    )

    if args.dry_run:
        print(json.dumps({
            "uid": args.uid,
            "profile": profile,
            "customClaims": {
                "role": "HOD",
                "department": profile["department"],
                "status": "Active",
                "permissions": DEFAULT_PERMISSIONS,
            },
        }, indent=2))
        return

    initialize_admin(str(service_account_path), args.project_id.strip())
    db = firestore.client()

    user_ref = db.collection("users").document(args.uid)
    user_ref.set({
        **profile,
        "createdAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }, merge=True)

    auth.update_user(
        args.uid,
        email=profile["email"],
        display_name=profile["name"],
        disabled=False,
    )
    auth.set_custom_user_claims(
        args.uid,
        {
            "role": "HOD",
            "department": profile["department"],
            "status": "Active",
            "permissions": DEFAULT_PERMISSIONS,
        },
    )

    print("Bootstrap complete.")
    print(f"Firestore document written: users/{args.uid}")
    print(f"Auth custom claims set for UID: {args.uid}")


if __name__ == "__main__":
    main()
