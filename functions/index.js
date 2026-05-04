const functions = require("firebase-functions");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const auth = admin.auth();
const FieldValue = admin.firestore.FieldValue;

const ROLES = {
  HOD: "HOD",
  MANAGER: "Manager",
  CHIEF_MANAGER: "Chief Manager",
  ENGINEER: "Engineer",
  PDC: "PDC",
  COMMERCIAL: "Commercial",
};

const DEPARTMENTS = {
  VDD: "VDD",
  PDC: "PDC",
  COMMERCIAL: "Commercial",
};

const STATUS = {
  PENDING: "Pending",
  COSTING_INITIATED: "Costing Initiated",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  REVIEW_PENDING: "Review Pending",
  REJECTED: "Rejected",
  COMMERCIAL_PENDING: "Commercial Pending",
  CLOSED: "Closed",
};

const DEFAULT_ALLOWED_CIDRS = [
  "127.0.0.1/32",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "0.0.0.0/0" // Temporarily allow all IPs for development
];

function cleanIpAddress(rawIp) {
  if (!rawIp) {
    return "";
  }

  const firstIp = String(rawIp).split(",")[0].trim();
  if (firstIp === "::1") {
    return "127.0.0.1";
  }

  return firstIp.replace("::ffff:", "");
}

function ipToInt(ip) {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return null;
  }

  return ((parts[0] << 24) >>> 0)
    + ((parts[1] << 16) >>> 0)
    + ((parts[2] << 8) >>> 0)
    + (parts[3] >>> 0);
}

function cidrContainsIp(cidr, ip) {
  const [range, prefixString] = cidr.split("/");
  const prefix = Number(prefixString);
  const rangeInt = ipToInt(range);
  const ipInt = ipToInt(ip);

  if (rangeInt === null || ipInt === null || Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  return (rangeInt & mask) === (ipInt & mask);
}

function getAllowedCidrs() {
  const configured = process.env.JK_ALLOWED_CIDRS
    || (functions.config().network && functions.config().network.allowed_cidrs);

  if (!configured) {
    return DEFAULT_ALLOWED_CIDRS;
  }

  return String(configured)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getClientIp(requestLike) {
  if (!requestLike) {
    return "";
  }

  const headerIp = requestLike.headers && requestLike.headers["x-forwarded-for"];
  const socketIp = requestLike.connection && requestLike.connection.remoteAddress;
  const reqIp = requestLike.ip;
  return cleanIpAddress(headerIp || reqIp || socketIp);
}

function isAllowedIp(ip) {
  if (!ip) {
    return false;
  }

  return getAllowedCidrs().some((cidr) => cidrContainsIp(cidr, ip));
}

function assertAllowedNetwork(requestLike) {
  const clientIp = getClientIp(requestLike);
  // TEMPORARILY BYPASSED as requested:
  // if (!isAllowedIp(clientIp)) {
  //   throw new functions.https.HttpsError(
  //     "permission-denied",
  //     "Access is restricted to JK Tyre approved network ranges.",
  //   );
  // }

  return clientIp;
}

function assertAuthenticated(context) {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication is required.");
  }
}

async function getUserProfile(uid) {
  const snapshot = await db.collection("users").doc(uid).get();
  if (!snapshot.exists) {
    throw new functions.https.HttpsError("permission-denied", "User profile not found.");
  }

  const profile = snapshot.data();
  return {
    id: snapshot.id,
    ...profile,
  };
}

function getDefaultPermissions(role, department) {
  const managementRole = role === ROLES.HOD || role === ROLES.MANAGER || role === ROLES.CHIEF_MANAGER;
  return {
    viewCosting: true,
    editCosting: role === ROLES.HOD || role === ROLES.ENGINEER || managementRole,
    approveReports: role === ROLES.HOD || managementRole,
    accessAllDepartments: role === ROLES.HOD || managementRole,
    manageUsers: role === ROLES.HOD,
    manageAssignments: role === ROLES.HOD || managementRole,
    manageCommercial: role === ROLES.HOD || role === ROLES.COMMERCIAL,
    manageAuditLogs: role === ROLES.HOD,
    submitRequests: role === ROLES.HOD || role === ROLES.PDC || department === DEPARTMENTS.PDC,
  };
}

function resolvePermissions(role, department, customPermissions) {
  return {
    ...getDefaultPermissions(role, department),
    ...(customPermissions || {}),
  };
}

function claimsFromProfile(profile) {
  return {
    role: profile.role,
    department: profile.department,
    permissions: profile.permissions || {},
  };
}

function requireRoles(profile, allowedRoles) {
  if (!allowedRoles.includes(profile.role)) {
    throw new functions.https.HttpsError("permission-denied", "You do not have access to this action.");
  }
}

function requirePermission(profile, permissionKey) {
  if (profile.role === ROLES.HOD) {
    return;
  }

  if (!profile.permissions || profile.permissions[permissionKey] !== true) {
    throw new functions.https.HttpsError("permission-denied", `Missing permission: ${permissionKey}`);
  }
}

function ensureNonEmptyString(value, fieldName) {
  if (!value || typeof value !== "string" || !value.trim()) {
    throw new functions.https.HttpsError("invalid-argument", `${fieldName} is required.`);
  }
  return value.trim();
}

function ensureArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new functions.https.HttpsError("invalid-argument", `${fieldName} must be an array.`);
  }
  return value;
}

function sanitizeAttachments(attachments) {
  return ensureArray(attachments || [], "attachments").map((attachment) => ({
    name: ensureNonEmptyString(attachment.name, "attachment.name"),
    url: ensureNonEmptyString(attachment.url, "attachment.url"),
    bucket: String(attachment.bucket || "").trim() || null,
    fullPath: ensureNonEmptyString(attachment.fullPath, "attachment.fullPath"),
    contentType: String(attachment.contentType || ""),
    size: Number(attachment.size || 0),
    uploadedAt: attachment.uploadedAt || new Date().toISOString(),
  }));
}

function normalizeOcrText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[•·]/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeComparable(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitDocumentLines(text) {
  return normalizeOcrText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function cleanExtractedValue(value) {
  return String(value || "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[:\-–—\s]+/, "")
    .replace(/\s+[:\-–—]+$/, "")
    .trim();
}

function looksLikeNewFieldLabel(value) {
  if (!value) {
    return false;
  }

  const compact = value.replace(/\s+/g, " ").trim();
  return /^[A-Z][A-Za-z0-9 /().,&-]{2,50}:?$/.test(compact);
}

function extractLabeledValue(text, labels, {multiline = false} = {}) {
  const lines = splitDocumentLines(text);
  const comparableLabels = labels.map((label) => normalizeComparable(label));

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalizedLine = normalizeComparable(line);
    const matchingLabel = comparableLabels.find((label) => normalizedLine.includes(label));
    if (!matchingLabel) {
      continue;
    }

    let extracted = "";
    const rawLabel = labels[comparableLabels.indexOf(matchingLabel)];
    const labelPattern = new RegExp(`${escapeRegExp(rawLabel)}\\s*[:\\-–—]?\\s*(.*)$`, "i");
    const labelMatch = line.match(labelPattern);
    if (labelMatch && cleanExtractedValue(labelMatch[1])) {
      extracted = cleanExtractedValue(labelMatch[1]);
    } else {
      const remainder = cleanExtractedValue(line.replace(new RegExp(escapeRegExp(rawLabel), "i"), ""));
      if (remainder && remainder !== cleanExtractedValue(line)) {
        extracted = remainder;
      }
    }

    if (!multiline) {
      if (!extracted && lines[index + 1] && !looksLikeNewFieldLabel(lines[index + 1])) {
        extracted = cleanExtractedValue(lines[index + 1]);
      }
      if (extracted) {
        return extracted;
      }
      continue;
    }

    const chunks = [];
    if (extracted) {
      chunks.push(extracted);
    }

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextLine = cleanExtractedValue(lines[cursor]);
      if (!nextLine || looksLikeNewFieldLabel(nextLine)) {
        break;
      }
      chunks.push(nextLine);
    }

    const combined = cleanExtractedValue(chunks.join(" "));
    if (combined) {
      return combined;
    }
  }

  return "";
}

function pickBestOption(value, options) {
  const normalizedValue = normalizeComparable(value);
  if (!normalizedValue) {
    return "";
  }

  for (const option of options) {
    const normalizedOption = normalizeComparable(option);
    if (normalizedValue === normalizedOption || normalizedValue.includes(normalizedOption) || normalizedOption.includes(normalizedValue)) {
      return option;
    }
  }

  const valueTokens = new Set(normalizedValue.split(" ").filter(Boolean));
  let bestOption = "";
  let bestScore = 0;

  for (const option of options) {
    const optionTokens = normalizeComparable(option).split(" ").filter(Boolean);
    if (!optionTokens.length) {
      continue;
    }

    const overlap = optionTokens.filter((token) => valueTokens.has(token)).length;
    const score = overlap / optionTokens.length;
    if (score > bestScore) {
      bestScore = score;
      bestOption = option;
    }
  }

  return bestScore >= 0.5 ? bestOption : "";
}

function parseDocumentDate(value) {
  const raw = cleanExtractedValue(value);
  if (!raw) {
    return "";
  }

  const directMatch = raw.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
  if (directMatch) {
    const day = Number(directMatch[1]);
    const month = Number(directMatch[2]);
    let year = Number(directMatch[3]);
    if (year < 100) {
      year += 2000;
    }
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function compactSuggestedFields(fields) {
  return Object.entries(fields).reduce((accumulator, [key, value]) => {
    const cleaned = typeof value === "string" ? cleanExtractedValue(value) : value;
    if (cleaned) {
      accumulator[key] = cleaned;
    }
    return accumulator;
  }, {});
}

function extractTestRequestFieldsFromText(text) {
  const suggestions = compactSuggestedFields({
    htacNo: extractLabeledValue(text, ["HTAC No.", "HTAC No", "HTAC Number"]),
    dateOfReceipt: parseDocumentDate(extractLabeledValue(text, ["Date of Receipt of Sample", "Date of Receipt", "Receipt Date"])),
    referenceNo: extractLabeledValue(text, ["Project No. / Reference No.", "Project No / Reference No", "Reference No.", "Reference No", "Project No."]),
    projectId: extractLabeledValue(text, ["Project ID"]),
    testId: extractLabeledValue(text, ["Test ID"]),
    sampleDetails: extractLabeledValue(text, ["Sample Details", "Sample Description"], {multiline: true}),
    customerCode: extractLabeledValue(text, ["Customer Code"]),
    customerIdName: extractLabeledValue(text, ["Customer ID - Name", "Customer ID Name", "Customer Name"]),
    customerGST: extractLabeledValue(text, ["Customer GST Number", "GST Number", "GSTIN"]),
    originatorReference: extractLabeledValue(text, ["Originator Reference"]),
    tyreDetails: extractLabeledValue(text, ["Tyre Details", "Tire Details"], {multiline: true}),
    description: extractLabeledValue(text, ["Description"], {multiline: true}),
    remarks: extractLabeledValue(text, ["Remarks"], {multiline: true}),
    paymentDetails: extractLabeledValue(text, ["Payment Details"], {multiline: true}),
    activeStatus: pickBestOption(extractLabeledValue(text, ["Active / Inactive", "Status"]), ["Active", "Inactive"]),
    priority: pickBestOption(extractLabeledValue(text, ["Priority"]), ["Low", "Medium", "High", "Critical"]),
    testType: pickBestOption(extractLabeledValue(text, ["Test Type", "Type of Test"]), [
      "Durability",
      "Rolling Resistance",
      "Traction / Braking",
      "NVH",
      "Endurance",
      "Wet Handling",
    ]),
    contractReview: pickBestOption(extractLabeledValue(text, ["Contract Review"]), [
      "Applicable - Contract Reviewed & Approved",
      "Not Applicable - Internal Test",
      "Pending Review",
    ]),
    physicalLab: pickBestOption(extractLabeledValue(text, ["Physical Lab", "Lab"]), [
      "Physical Lab - Mysuru (RPSCOE)",
      "Physical Lab - Indore (NATRAX)",
      "Virtual Simulation Lab",
    ]),
  });

  if (suggestions.physicalLab) {
    suggestions.physicalLabEnabled = suggestions.physicalLab !== "Virtual Simulation Lab";
  }

  return suggestions;
}

async function getServiceAccessToken() {
  const credential = admin.app().options.credential;
  if (!credential || typeof credential.getAccessToken !== "function") {
    throw new Error("Application default credentials are not available for OCR.");
  }

  const tokenResponse = await credential.getAccessToken();
  return tokenResponse.access_token;
}

async function callVisionApi(endpoint, body) {
  const accessToken = await getServiceAccessToken();
  const projectId = process.env.GCLOUD_PROJECT || admin.app().options.projectId;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
      ...(projectId ? {"x-goog-user-project": projectId} : {}),
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  if (!response.ok) {
    const message = payload && payload.error && payload.error.message
      ? payload.error.message
      : "Cloud Vision OCR request failed.";
    throw new Error(message);
  }

  return payload;
}

async function runVisionOcrForDocument({bucket, fullPath, contentType}) {
  const gcsUri = `gs://${bucket}/${fullPath}`;

  if (contentType === "application/pdf") {
    const result = await callVisionApi("https://vision.googleapis.com/v1/files:annotate", {
      requests: [
        {
          inputConfig: {
            gcsSource: {uri: gcsUri},
            mimeType: contentType,
          },
          features: [{type: "DOCUMENT_TEXT_DETECTION"}],
          pages: [1, 2, 3, 4, 5],
        },
      ],
    });

    const pageResponses = (((result.responses || [])[0] || {}).responses || []);
    const text = pageResponses
      .map((page) => (((page || {}).fullTextAnnotation || {}).text || "").trim())
      .filter(Boolean)
      .join("\n\n");

    return {
      text,
      pagesProcessed: pageResponses.length,
    };
  }

  if (String(contentType || "").startsWith("image/")) {
    const result = await callVisionApi("https://vision.googleapis.com/v1/images:annotate", {
      requests: [
        {
          image: {
            source: {
              imageUri: gcsUri,
            },
          },
          features: [{type: "DOCUMENT_TEXT_DETECTION"}],
        },
      ],
    });

    const response = (result.responses || [])[0] || {};
    return {
      text: (((response || {}).fullTextAnnotation || {}).text || "").trim(),
      pagesProcessed: response.fullTextAnnotation ? 1 : 0,
    };
  }

  throw new functions.https.HttpsError("invalid-argument", "Only PDF and image files are supported for OCR.");
}

function calculateTotalCost(lineItems) {
  return lineItems.reduce((sum, item) => sum + Number(item.cost || 0), 0);
}

function sanitizeLineItems(lineItems) {
  return ensureArray(lineItems, "lineItems").map((item, index) => ({
    id: String(item.id || `${index + 1}`),
    category: ensureNonEmptyString(item.category, `lineItems[${index}].category`),
    description: ensureNonEmptyString(item.description, `lineItems[${index}].description`),
    cost: Number(item.cost || 0),
  }));
}

function compactObject(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => compactObject(entry));
  }

  if (typeof value !== "object") {
    return value;
  }

  return Object.entries(value).reduce((accumulator, [key, entry]) => {
    if (entry !== undefined) {
      accumulator[key] = compactObject(entry);
    }
    return accumulator;
  }, {});
}

async function writeAuditLog({
  actor,
  action,
  entityType,
  entityId,
  fieldChanged,
  oldValue = null,
  newValue = null,
  metadata = {},
  clientIp = "",
}) {
  await db.collection("audit_logs").add({
    user_id: actor.id,
    user_name: actor.name,
    user_role: actor.role,
    action,
    entity_type: entityType,
    entity_id: entityId,
    field_changed: fieldChanged,
    old_value: compactObject(oldValue),
    new_value: compactObject(newValue),
    metadata: compactObject(metadata),
    client_ip: clientIp,
    timestamp: FieldValue.serverTimestamp(),
  });
}

async function createNotificationsForRole(targetRoles, payload) {
  const querySnapshot = await db.collection("users")
    .where("status", "==", "Active")
    .where("role", "in", targetRoles)
    .get();

  const writes = querySnapshot.docs.map((userSnapshot) => db.collection("notifications").add({
    userId: userSnapshot.id,
    title: payload.title,
    message: payload.message,
    link: payload.link || null,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  }));

  await Promise.all(writes);
}

function getBootstrapSetupKey() {
  return process.env.BOOTSTRAP_SETUP_KEY
    || (functions.config().setup && functions.config().setup.key)
    || "";
}

exports.networkAccessCheck = functions.https.onRequest((req, res) => {
  const clientIp = getClientIp(req);
  if (!isAllowedIp(clientIp)) {
    res.status(403).json({
      ok: false,
      message: "Access denied. This application is available only on JK Tyre approved networks.",
    });
    return;
  }

  res.json({
    ok: true,
    message: "Network access verified.",
    ip: clientIp,
  });
});

exports.bootstrapFirstHod = functions.https.onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({
        success: false,
        message: "Only POST is allowed.",
      });
      return;
    }

    const clientIp = assertAllowedNetwork(req);
    const setupKey = getBootstrapSetupKey();
    if (!setupKey) {
      res.status(500).json({
        success: false,
        message: "Bootstrap setup key is not configured.",
      });
      return;
    }

    const providedSetupKey = ensureNonEmptyString(req.body.setupKey, "setupKey");
    if (providedSetupKey !== setupKey) {
      res.status(403).json({
        success: false,
        message: "Invalid bootstrap setup key.",
      });
      return;
    }

    const existingHodSnapshot = await db.collection("users")
      .where("role", "==", ROLES.HOD)
      .limit(1)
      .get();

    if (!existingHodSnapshot.empty) {
      res.status(409).json({
        success: false,
        message: "Bootstrap is already completed. HOD already exists.",
      });
      return;
    }

    const email = ensureNonEmptyString(req.body.email, "email").toLowerCase();
    const password = ensureNonEmptyString(req.body.password, "password");
    const name = ensureNonEmptyString(req.body.name || "HOD Admin", "name");

    const permissions = resolvePermissions(ROLES.HOD, DEPARTMENTS.VDD, {
      viewCosting: true,
      editCosting: true,
      approveReports: true,
      accessAllDepartments: true,
      manageUsers: true,
      manageAssignments: true,
      manageCommercial: true,
      manageAuditLogs: true,
      submitRequests: true,
    });

    const userRecord = await auth.createUser({
      email,
      password,
      displayName: name,
      disabled: false,
    });

    const userProfile = {
      name,
      email,
      department: DEPARTMENTS.VDD,
      role: ROLES.HOD,
      permissions,
      status: "Active",
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: "system-bootstrap",
      createdByName: "System Bootstrap",
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: "system-bootstrap",
      updatedByName: "System Bootstrap",
    };

    await db.collection("users").doc(userRecord.uid).set(userProfile);
    await auth.setCustomUserClaims(userRecord.uid, claimsFromProfile(userProfile));
    await writeAuditLog({
      actor: {
        id: "system-bootstrap",
        name: "System Bootstrap",
        role: "System",
      },
      action: "FIRST_HOD_BOOTSTRAPPED",
      entityType: "user",
      entityId: userRecord.uid,
      fieldChanged: "bootstrap_hod",
      newValue: {
        email,
        role: ROLES.HOD,
        department: DEPARTMENTS.VDD,
      },
      clientIp,
    });

    res.status(200).json({
      success: true,
      uid: userRecord.uid,
      email,
      message: "First HOD user created successfully.",
    });
  } catch (error) {
    console.error("bootstrapFirstHod failed", error);
    res.status(500).json({
      success: false,
      message: error.message || "Bootstrap failed.",
    });
  }
});

exports.bootstrapExistingHod = functions.https.onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({
        success: false,
        message: "Only POST is allowed.",
      });
      return;
    }

    const clientIp = assertAllowedNetwork(req);
    const setupKey = getBootstrapSetupKey();
    if (!setupKey) {
      res.status(500).json({
        success: false,
        message: "Bootstrap setup key is not configured.",
      });
      return;
    }

    const providedSetupKey = ensureNonEmptyString(req.body.setupKey, "setupKey");
    if (providedSetupKey !== setupKey) {
      res.status(403).json({
        success: false,
        message: "Invalid bootstrap setup key.",
      });
      return;
    }

    const uid = ensureNonEmptyString(req.body.uid, "uid");
    const authUser = await auth.getUser(uid);

    const existingHodSnapshot = await db.collection("users")
      .where("role", "==", ROLES.HOD)
      .limit(1)
      .get();

    if (!existingHodSnapshot.empty && existingHodSnapshot.docs[0].id !== uid) {
      res.status(409).json({
        success: false,
        message: "Another HOD already exists. Existing auth user cannot be bootstrapped as first HOD.",
      });
      return;
    }

    const email = ensureNonEmptyString(req.body.email || authUser.email || "", "email").toLowerCase();
    const name = ensureNonEmptyString(req.body.name || authUser.displayName || "HOD Admin", "name");

    const permissions = resolvePermissions(ROLES.HOD, DEPARTMENTS.VDD, {
      viewCosting: true,
      editCosting: true,
      approveReports: true,
      accessAllDepartments: true,
      manageUsers: true,
      manageAssignments: true,
      manageCommercial: true,
      manageAuditLogs: true,
      submitRequests: true,
    });

    const userProfile = {
      name,
      email,
      department: DEPARTMENTS.VDD,
      role: ROLES.HOD,
      permissions,
      status: "Active",
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: "system-bootstrap",
      createdByName: "System Bootstrap",
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: "system-bootstrap",
      updatedByName: "System Bootstrap",
    };

    await db.collection("users").doc(uid).set(userProfile, { merge: true });
    await auth.updateUser(uid, {
      email,
      displayName: name,
      disabled: false,
    });
    await auth.setCustomUserClaims(uid, claimsFromProfile(userProfile));
    await writeAuditLog({
      actor: {
        id: "system-bootstrap",
        name: "System Bootstrap",
        role: "System",
      },
      action: "EXISTING_AUTH_HOD_BOOTSTRAPPED",
      entityType: "user",
      entityId: uid,
      fieldChanged: "bootstrap_existing_hod",
      newValue: {
        email,
        role: ROLES.HOD,
        department: DEPARTMENTS.VDD,
      },
      clientIp,
    });

    res.status(200).json({
      success: true,
      uid,
      email,
      message: "Existing auth user linked as HOD successfully.",
    });
  } catch (error) {
    console.error("bootstrapExistingHod failed", error);
    res.status(500).json({
      success: false,
      message: error.message || "Existing HOD bootstrap failed.",
    });
  }
});

exports.createUser = functions.https.onCall(async (data, context) => {
  try {
    assertAuthenticated(context);
    const clientIp = assertAllowedNetwork(context.rawRequest);
    const actor = await getUserProfile(context.auth.uid);
    requirePermission(actor, "manageUsers");

    const email = ensureNonEmptyString(data.email, "email").toLowerCase();
    const password = ensureNonEmptyString(data.password, "password");
    const name = ensureNonEmptyString(data.name, "name");
    const department = ensureNonEmptyString(data.department, "department");
    const role = ensureNonEmptyString(data.role, "role");
    const permissions = resolvePermissions(role, department, data.permissions);
    const status = data.status === "Disabled" ? "Disabled" : "Active";

    const userRecord = await auth.createUser({
      email,
      password,
      displayName: name,
      disabled: status === "Disabled",
    });

    const userProfile = {
      name,
      email,
      department,
      role,
      permissions,
      status,
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: actor.id,
      createdByName: actor.name,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actor.id,
      updatedByName: actor.name,
    };

    await db.collection("users").doc(userRecord.uid).set(userProfile);
    await auth.setCustomUserClaims(userRecord.uid, claimsFromProfile(userProfile));
    await writeAuditLog({
      actor,
      action: "USER_CREATED",
      entityType: "user",
      entityId: userRecord.uid,
      fieldChanged: "user",
      newValue: { email, department, role, permissions, status },
      metadata: { email },
      clientIp,
    });

    return {
      success: true,
      uid: userRecord.uid,
    };
  } catch (error) {
    console.error("createUser error:", error);
    if (error.code && typeof error.code === 'string' && error.code.startsWith('auth/')) {
      throw new functions.https.HttpsError("invalid-argument", error.message);
    }
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError("internal", error.message || "An unexpected error occurred");
  }
});

exports.updateUserAccess = functions.https.onCall(async (data, context) => {
  assertAuthenticated(context);
  const clientIp = assertAllowedNetwork(context.rawRequest);
  const actor = await getUserProfile(context.auth.uid);
  requirePermission(actor, "manageUsers");

  const uid = ensureNonEmptyString(data.uid, "uid");
  const userRef = db.collection("users").doc(uid);
  const userSnapshot = await userRef.get();
  if (!userSnapshot.exists) {
    throw new functions.https.HttpsError("not-found", "User not found.");
  }

  const existing = userSnapshot.data();
  const role = data.role ? ensureNonEmptyString(data.role, "role") : existing.role;
  const department = data.department ? ensureNonEmptyString(data.department, "department") : existing.department;
  const permissions = resolvePermissions(role, department, data.permissions || existing.permissions);
  const status = data.status === "Disabled" ? "Disabled" : "Active";

  const updates = {
    name: data.name ? ensureNonEmptyString(data.name, "name") : existing.name,
    email: data.email ? ensureNonEmptyString(data.email, "email").toLowerCase() : existing.email,
    role,
    department,
    permissions,
    status,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByUid: actor.id,
    updatedByName: actor.name,
  };

  await auth.updateUser(uid, {
    email: updates.email,
    displayName: updates.name,
    disabled: status === "Disabled",
  });
  await userRef.update(updates);
  await auth.setCustomUserClaims(uid, claimsFromProfile(updates));
  await writeAuditLog({
    actor,
    action: "USER_UPDATED",
    entityType: "user",
    entityId: uid,
    fieldChanged: "user_access",
    oldValue: {
      name: existing.name,
      email: existing.email,
      role: existing.role,
      department: existing.department,
      permissions: existing.permissions,
      status: existing.status,
    },
    newValue: {
      name: updates.name,
      email: updates.email,
      role: updates.role,
      department: updates.department,
      permissions: updates.permissions,
      status: updates.status,
    },
    clientIp,
  });

  return { success: true };
});

exports.extractTestRequestFromDocument = functions.https.onCall(async (data, context) => {
  assertAuthenticated(context);
  assertAllowedNetwork(context.rawRequest);
  const actor = await getUserProfile(context.auth.uid);
  requireRoles(actor, [ROLES.HOD, ROLES.PDC]);
  requirePermission(actor, "submitRequests");

  const bucket = ensureNonEmptyString(data.bucket, "bucket");
  const fullPath = ensureNonEmptyString(data.fullPath, "fullPath");
  const contentType = ensureNonEmptyString(data.contentType, "contentType");
  const fileName = ensureNonEmptyString(data.name || fullPath.split("/").pop() || "attachment", "name");

  try {
    const {text, pagesProcessed} = await runVisionOcrForDocument({
      bucket,
      fullPath,
      contentType,
    });
    const normalizedText = normalizeOcrText(text);
    if (!normalizedText) {
      return {
        success: true,
        name: fileName,
        pagesProcessed,
        text: "",
        suggestions: {},
        warnings: ["No readable text was detected in the uploaded document."],
      };
    }

    const suggestions = extractTestRequestFieldsFromText(normalizedText);
    const missingRequiredFields = [
      "htacNo",
      "dateOfReceipt",
      "projectId",
      "testId",
      "sampleDetails",
      "customerCode",
      "customerIdName",
      "originatorReference",
      "testType",
      "priority",
      "tyreDetails",
    ].filter((fieldName) => !suggestions[fieldName]);

    return {
      success: true,
      name: fileName,
      pagesProcessed,
      text: normalizedText,
      suggestions,
      warnings: missingRequiredFields.length
        ? [`OCR could not confidently map: ${missingRequiredFields.join(", ")}`]
        : [],
    };
  } catch (error) {
    console.error("extractTestRequestFromDocument error:", error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    const message = String(error.message || "");
    if (message.includes("SERVICE_DISABLED") || message.includes("Cloud Vision API has not been used")) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "OCR is not available until the Cloud Vision API is enabled for this Firebase project.",
      );
    }

    throw new functions.https.HttpsError("internal", message || "OCR extraction failed.");
  }
});

exports.submitTestRequest = functions.https.onCall(async (data, context) => {
  assertAuthenticated(context);
  const clientIp = assertAllowedNetwork(context.rawRequest);
  const actor = await getUserProfile(context.auth.uid);
  requireRoles(actor, [ROLES.HOD, ROLES.PDC]);
  requirePermission(actor, "submitRequests");

  const requestId = ensureNonEmptyString(data.requestId, "requestId");
  const requestRef = db.collection("test_requests").doc(requestId);
  const existingRequest = await requestRef.get();
  if (existingRequest.exists) {
    throw new functions.https.HttpsError("already-exists", "This request already exists.");
  }

  const payload = {
    htacNo: String(data.htacNo || "").trim(),
    dateOfReceipt: String(data.dateOfReceipt || "").trim(),
    referenceNo: String(data.referenceNo || "").trim(),
    projectId: ensureNonEmptyString(data.projectId, "projectId"),
    testId: ensureNonEmptyString(data.testId, "testId"),
    sampleDetails: ensureNonEmptyString(data.sampleDetails, "sampleDetails"),
    customerCode: ensureNonEmptyString(data.customerCode, "customerCode"),
    customerIdName: ensureNonEmptyString(data.customerIdName, "customerIdName"),
    customerGST: String(data.customerGST || "").trim(),
    originatorReference: ensureNonEmptyString(data.originatorReference, "originatorReference"),
    contractReview: ensureNonEmptyString(data.contractReview, "contractReview"),
    physicalLabEnabled: Boolean(data.physicalLabEnabled),
    physicalLab: String(data.physicalLab || "").trim(),
    tyreDetails: ensureNonEmptyString(data.tyreDetails, "tyreDetails"),
    testType: ensureNonEmptyString(data.testType, "testType"),
    priority: ensureNonEmptyString(data.priority, "priority"),
    description: String(data.description || "").trim(),
    remarks: String(data.remarks || "").trim(),
    paymentDetails: String(data.paymentDetails || "").trim(),
    activeStatus: data.activeStatus === "Inactive" ? "Inactive" : "Active",
    attachments: sanitizeAttachments(data.attachments),
    status: STATUS.PENDING,
    activeCostingId: null,
    assignedEngineerUid: null,
    assignedEngineerName: null,
    location: null,
    commercialStatus: null,
    createdByUid: actor.id,
    createdByName: actor.name,
    createdByDepartment: actor.department,
    requestedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await requestRef.set(payload);
  await writeAuditLog({
    actor,
    action: "TEST_REQUEST_CREATED",
    entityType: "test_request",
    entityId: requestId,
    fieldChanged: "request",
    newValue: {
      htacNo: payload.htacNo,
      projectId: payload.projectId,
      testId: payload.testId,
      status: payload.status,
    },
    clientIp,
  });
  await createNotificationsForRole([ROLES.ENGINEER, ROLES.MANAGER, ROLES.CHIEF_MANAGER, ROLES.HOD], {
    title: "New Test Request",
    message: `${payload.projectId} / ${payload.testId} requires costing initiation.`,
    link: `/requests?requestId=${requestId}`,
  });

  return { success: true, requestId };
});

exports.saveCosting = functions.https.onCall(async (data, context) => {
  assertAuthenticated(context);
  const clientIp = assertAllowedNetwork(context.rawRequest);
  const actor = await getUserProfile(context.auth.uid);
  requireRoles(actor, [ROLES.HOD, ROLES.MANAGER, ROLES.CHIEF_MANAGER, ROLES.ENGINEER]);
  requirePermission(actor, "editCosting");

  const requestId = ensureNonEmptyString(data.requestId, "requestId");
  const lineItems = sanitizeLineItems(data.lineItems);
  const notes = String(data.notes || "").trim();
  const totalCost = calculateTotalCost(lineItems);
  if (totalCost <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "Total cost must be greater than zero.");
  }

  const requestRef = db.collection("test_requests").doc(requestId);
  const requestSnapshot = await requestRef.get();
  if (!requestSnapshot.exists) {
    throw new functions.https.HttpsError("not-found", "Test request not found.");
  }

  const requestData = requestSnapshot.data();
  if (requestData.status === STATUS.CLOSED) {
    throw new functions.https.HttpsError("failed-precondition", "Closed workflows cannot be edited.");
  }

  const requestYear = new Date().getFullYear();
  const counterRef = db.collection("system_counters").doc(`htac_${requestYear}`);
  const costingRef = requestData.activeCostingId
    ? db.collection("costing").doc(requestData.activeCostingId)
    : db.collection("costing").doc();

  const result = await db.runTransaction(async (transaction) => {
    const requestInTx = await transaction.get(requestRef);
    const requestPayload = requestInTx.data();
    let htacNumber = "";
    let versionNumber = 1;
    let currentCosting = null;

    if (requestPayload.activeCostingId) {
      const activeCostingRef = db.collection("costing").doc(requestPayload.activeCostingId);
      const activeCostingSnapshot = await transaction.get(activeCostingRef);
      if (!activeCostingSnapshot.exists) {
        throw new functions.https.HttpsError("failed-precondition", "Active costing reference is invalid.");
      }

      currentCosting = activeCostingSnapshot.data();
      if (currentCosting.locked) {
        throw new functions.https.HttpsError("failed-precondition", "Closed costings cannot be edited.");
      }

      htacNumber = currentCosting.htacNumber;
      versionNumber = Number(currentCosting.currentVersion || 0) + 1;
    } else {
      const counterSnapshot = await transaction.get(counterRef);
      const nextSequence = counterSnapshot.exists ? Number(counterSnapshot.data().current || 0) + 1 : 1;
      htacNumber = `HTAC-${requestYear}-${String(nextSequence).padStart(4, "0")}`;
      transaction.set(counterRef, {
        current: nextSequence,
        year: requestYear,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    const costingDocument = {
      requestId,
      projectId: requestPayload.projectId,
      testId: requestPayload.testId,
      htacNumber,
      status: STATUS.COSTING_INITIATED,
      currentVersion: versionNumber,
      latestBreakdown: lineItems,
      notes,
      totalCost,
      locked: false,
      engineerUid: currentCosting ? currentCosting.engineerUid || null : null,
      engineerName: currentCosting ? currentCosting.engineerName || null : null,
      location: currentCosting ? currentCosting.location || null : null,
      billingStatus: currentCosting ? currentCosting.billingStatus || null : null,
      paymentDetails: currentCosting ? currentCosting.paymentDetails || null : null,
      createdByUid: currentCosting ? currentCosting.createdByUid : actor.id,
      createdByName: currentCosting ? currentCosting.createdByName : actor.name,
      createdAt: currentCosting ? currentCosting.createdAt : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actor.id,
      updatedByName: actor.name,
    };

    transaction.set(costingRef, costingDocument, { merge: true });
    transaction.set(costingRef.collection("versions").doc(String(versionNumber)), {
      version: versionNumber,
      lineItems,
      notes,
      totalCost,
      changedByUid: actor.id,
      changedByName: actor.name,
      createdAt: FieldValue.serverTimestamp(),
    });

    transaction.update(requestRef, {
      status: STATUS.COSTING_INITIATED,
      activeCostingId: costingRef.id,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      costingId: costingRef.id,
      htacNumber,
      versionNumber,
      previousVersion: currentCosting ? currentCosting.currentVersion || 0 : 0,
    };
  });

  await writeAuditLog({
    actor,
    action: result.previousVersion > 0 ? "COSTING_VERSION_CREATED" : "COSTING_CREATED",
    entityType: "costing",
    entityId: result.costingId,
    fieldChanged: "costing",
    oldValue: { version: result.previousVersion || null },
    newValue: {
      version: result.versionNumber,
      htacNumber: result.htacNumber,
      totalCost,
      notes,
      lineItems,
    },
    metadata: { requestId },
    clientIp,
  });

  return {
    success: true,
    costingId: result.costingId,
    htacNumber: result.htacNumber,
    version: result.versionNumber,
  };
});

exports.assignTest = functions.https.onCall(async (data, context) => {
  assertAuthenticated(context);
  const clientIp = assertAllowedNetwork(context.rawRequest);
  const actor = await getUserProfile(context.auth.uid);
  requireRoles(actor, [ROLES.HOD, ROLES.MANAGER, ROLES.CHIEF_MANAGER]);
  requirePermission(actor, "manageAssignments");

  const costingId = ensureNonEmptyString(data.costingId, "costingId");
  const engineerUid = ensureNonEmptyString(data.engineerUid, "engineerUid");
  const location = ensureNonEmptyString(data.location, "location");
  const deadline = ensureNonEmptyString(data.deadline, "deadline");

  const costingRef = db.collection("costing").doc(costingId);
  const costingSnapshot = await costingRef.get();
  if (!costingSnapshot.exists) {
    throw new functions.https.HttpsError("not-found", "Costing sheet not found.");
  }

  const costing = costingSnapshot.data();
  if (costing.locked) {
    throw new functions.https.HttpsError("failed-precondition", "Closed costings cannot be assigned.");
  }

  const requestRef = db.collection("test_requests").doc(costing.requestId);
  const engineer = await getUserProfile(engineerUid);
  requireRoles(engineer, [ROLES.ENGINEER]);

  const existingAssignmentSnapshot = await db.collection("assignments")
    .where("costingId", "==", costingId)
    .where("status", "in", [STATUS.ASSIGNED, STATUS.IN_PROGRESS, STATUS.REVIEW_PENDING, STATUS.COMMERCIAL_PENDING])
    .limit(1)
    .get();

  if (!existingAssignmentSnapshot.empty) {
    throw new functions.https.HttpsError("already-exists", "This costing is already assigned.");
  }

  const assignmentRef = db.collection("assignments").doc();
  const assignmentPayload = {
    costingId,
    requestId: costing.requestId,
    htacNumber: costing.htacNumber,
    projectId: costing.projectId,
    testId: costing.testId,
    engineerUid,
    engineerName: engineer.name,
    location,
    deadline,
    status: STATUS.ASSIGNED,
    assignedByUid: actor.id,
    assignedByName: actor.name,
    billingStatus: null,
    paymentDetails: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await assignmentRef.set(assignmentPayload);
  await Promise.all([
    costingRef.update({
      status: STATUS.ASSIGNED,
      engineerUid,
      engineerName: engineer.name,
      location,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actor.id,
      updatedByName: actor.name,
    }),
    requestRef.update({
      status: STATUS.ASSIGNED,
      assignedEngineerUid: engineerUid,
      assignedEngineerName: engineer.name,
      location,
      updatedAt: FieldValue.serverTimestamp(),
    }),
  ]);
  await writeAuditLog({
    actor,
    action: "TASK_ASSIGNED",
    entityType: "assignment",
    entityId: assignmentRef.id,
    fieldChanged: "assignment",
    newValue: {
      costingId,
      engineerUid,
      engineerName: engineer.name,
      deadline,
      location,
    },
    clientIp,
  });
  await db.collection("notifications").add({
    userId: engineerUid,
    title: "New Test Assignment",
    message: `${costing.htacNumber} has been assigned to you for ${location}.`,
    link: `/tasks?assignmentId=${assignmentRef.id}`,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { success: true, assignmentId: assignmentRef.id };
});

exports.submitExecutionUpdate = functions.https.onCall(async (data, context) => {
  assertAuthenticated(context);
  const clientIp = assertAllowedNetwork(context.rawRequest);
  const actor = await getUserProfile(context.auth.uid);
  requireRoles(actor, [ROLES.HOD, ROLES.ENGINEER]);

  const assignmentId = ensureNonEmptyString(data.assignmentId, "assignmentId");
  const requestedStatus = ensureNonEmptyString(data.status, "status");
  const executionNote = String(data.executionNote || "").trim();
  const rawDataFiles = sanitizeAttachments(data.rawDataFiles || []);
  const finalReportFiles = sanitizeAttachments(data.finalReportFiles || []);

  const assignmentRef = db.collection("assignments").doc(assignmentId);
  const assignmentSnapshot = await assignmentRef.get();
  if (!assignmentSnapshot.exists) {
    throw new functions.https.HttpsError("not-found", "Assignment not found.");
  }

  const assignment = assignmentSnapshot.data();
  if (actor.role !== ROLES.HOD && assignment.engineerUid !== actor.id) {
    throw new functions.https.HttpsError("permission-denied", "Only the assigned engineer can update this task.");
  }

  const costingRef = db.collection("costing").doc(assignment.costingId);
  const requestRef = db.collection("test_requests").doc(assignment.requestId);
  const reportRef = db.collection("reports").doc(assignmentId);
  const workflowStatus = requestedStatus === STATUS.REVIEW_PENDING || requestedStatus === "Completed"
    ? STATUS.REVIEW_PENDING
    : STATUS.IN_PROGRESS;

  await reportRef.set({
    assignmentId,
    costingId: assignment.costingId,
    requestId: assignment.requestId,
    htacNumber: assignment.htacNumber,
    projectId: assignment.projectId,
    testId: assignment.testId,
    engineerUid: actor.id,
    engineerName: actor.name,
    rawDataFiles,
    finalReportFiles,
    executionNote,
    status: workflowStatus,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await Promise.all([
    assignmentRef.update({
      status: workflowStatus,
      updatedAt: FieldValue.serverTimestamp(),
    }),
    costingRef.update({
      status: workflowStatus,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actor.id,
      updatedByName: actor.name,
    }),
    requestRef.update({
      status: workflowStatus,
      updatedAt: FieldValue.serverTimestamp(),
    }),
  ]);
  await writeAuditLog({
    actor,
    action: "EXECUTION_UPDATED",
    entityType: "report",
    entityId: assignmentId,
    fieldChanged: "execution_status",
    newValue: {
      status: workflowStatus,
      rawFiles: rawDataFiles.length,
      finalFiles: finalReportFiles.length,
    },
    clientIp,
  });

  return { success: true };
});

exports.reviewReport = functions.https.onCall(async (data, context) => {
  assertAuthenticated(context);
  const clientIp = assertAllowedNetwork(context.rawRequest);
  const actor = await getUserProfile(context.auth.uid);
  requireRoles(actor, [ROLES.HOD, ROLES.MANAGER, ROLES.CHIEF_MANAGER]);
  requirePermission(actor, "approveReports");

  const reportId = ensureNonEmptyString(data.reportId, "reportId");
  const decision = ensureNonEmptyString(data.decision, "decision");
  const comment = String(data.comment || "").trim();

  const reportRef = db.collection("reports").doc(reportId);
  const reportSnapshot = await reportRef.get();
  if (!reportSnapshot.exists) {
    throw new functions.https.HttpsError("not-found", "Report not found.");
  }

  const report = reportSnapshot.data();
  const assignmentRef = db.collection("assignments").doc(report.assignmentId);
  const costingRef = db.collection("costing").doc(report.costingId);
  const requestRef = db.collection("test_requests").doc(report.requestId);

  const approved = decision.toLowerCase() === "approve";
  if (!approved && !comment) {
    throw new functions.https.HttpsError("invalid-argument", "Comment is required when rejecting a report.");
  }

  const nextStatus = approved ? STATUS.COMMERCIAL_PENDING : STATUS.IN_PROGRESS;

  await Promise.all([
    reportRef.update({
      status: approved ? "Approved" : "Rejected",
      managerComment: comment,
      reviewedByUid: actor.id,
      reviewedByName: actor.name,
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
    assignmentRef.update({
      status: nextStatus,
      updatedAt: FieldValue.serverTimestamp(),
    }),
    costingRef.update({
      status: nextStatus,
      reviewComment: comment,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actor.id,
      updatedByName: actor.name,
    }),
    requestRef.update({
      status: nextStatus,
      updatedAt: FieldValue.serverTimestamp(),
    }),
  ]);
  await writeAuditLog({
    actor,
    action: approved ? "REPORT_APPROVED" : "REPORT_REJECTED",
    entityType: "report",
    entityId: reportId,
    fieldChanged: "review",
    newValue: {
      decision: approved ? "Approved" : "Rejected",
      comment,
    },
    clientIp,
  });

  return { success: true };
});

exports.updateCommercialRecord = functions.https.onCall(async (data, context) => {
  assertAuthenticated(context);
  const clientIp = assertAllowedNetwork(context.rawRequest);
  const actor = await getUserProfile(context.auth.uid);
  requireRoles(actor, [ROLES.HOD, ROLES.COMMERCIAL]);
  requirePermission(actor, "manageCommercial");

  const assignmentId = ensureNonEmptyString(data.assignmentId, "assignmentId");
  const billingStatus = ensureNonEmptyString(data.billingStatus, "billingStatus");
  const paymentDetails = {
    invoiceNumber: String(data.invoiceNumber || "").trim(),
    paymentReference: String(data.paymentReference || "").trim(),
    amount: Number(data.amount || 0),
    comment: String(data.comment || "").trim(),
    updatedByUid: actor.id,
    updatedByName: actor.name,
    updatedAt: new Date().toISOString(),
  };
  const markClosed = Boolean(data.markClosed);

  const assignmentRef = db.collection("assignments").doc(assignmentId);
  const assignmentSnapshot = await assignmentRef.get();
  if (!assignmentSnapshot.exists) {
    throw new functions.https.HttpsError("not-found", "Assignment not found.");
  }

  const assignment = assignmentSnapshot.data();
  const nextStatus = markClosed ? STATUS.CLOSED : STATUS.COMMERCIAL_PENDING;
  const costingRef = db.collection("costing").doc(assignment.costingId);
  const requestRef = db.collection("test_requests").doc(assignment.requestId);
  const reportRef = db.collection("reports").doc(assignmentId);

  await Promise.all([
    assignmentRef.update({
      billingStatus,
      paymentDetails,
      status: nextStatus,
      closedAt: markClosed ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp(),
    }),
    costingRef.update({
      billingStatus,
      paymentDetails,
      status: nextStatus,
      locked: markClosed,
      closedAt: markClosed ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actor.id,
      updatedByName: actor.name,
    }),
    requestRef.update({
      commercialStatus: billingStatus,
      status: nextStatus,
      closedAt: markClosed ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp(),
    }),
    reportRef.set({
      commercialStatus: billingStatus,
      paymentDetails,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);
  await writeAuditLog({
    actor,
    action: markClosed ? "WORKFLOW_CLOSED" : "COMMERCIAL_UPDATED",
    entityType: "assignment",
    entityId: assignmentId,
    fieldChanged: "commercial",
    newValue: {
      billingStatus,
      paymentDetails,
      status: nextStatus,
    },
    clientIp,
  });

  return { success: true };
});
