const assert = require('node:assert/strict');
const { test } = require('node:test');
const { reviewAccountClosure } = require('../account-closure-review');

const reviewResult = {
  preliminaryJudgment: 'shared_data_requires_review',
  rationale: 'Des éléments partagés doivent être vérifiés avant de clôturer la demande.',
  checks: ['Vérifier les rendez-vous concernés.'],
  administratorDecisionRequired: true
};
const emptyInventory = {
  professionalDocuments: 0,
  privateMessages: 0,
  notifications: 0,
  notificationDeliveries: 0,
  pushSubscriptions: 0,
  directoryBookings: 0,
  accountComplianceRecords: 0,
  organizations: 0,
  teamMemberships: 0,
  servicePartners: 0,
  liaisonLogs: 0,
  planningRecipients: 0,
  sharedNotes: 0,
  careVisits: 0,
  serviceBookings: 0,
  visitEvents: 0,
  visitEvaluations: 0,
  planningAccessAudits: 0,
  aiMessages: 0,
  wellbeingCheckins: 0,
  wellbeingCheckinShares: 0
};

test('requires a configured OpenAI API key for account-closure pre-review', async () => {
  await assert.rejects(
    reviewAccountClosure({ accountRole: 'senior', accountTier: 'free_or_inactive', inventory: {}, apiKey: '' }),
    error => error.status === 503
  );
});

test('sends only allowlisted account metadata and record counts, without storing the response', async () => {
  const originalFetch = global.fetch;
  let requestUrl;
  let requestOptions;
  global.fetch = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return new Response(JSON.stringify({ output_text: JSON.stringify(reviewResult) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const summary = await reviewAccountClosure({
      accountRole: 'senior',
      accountTier: 'free_or_inactive',
      inventory: { ...emptyInventory, liaisonLogs: 2, sharedNotes: 1, rawNoteContent: 'sensitive text' },
      apiKey: 'test-key'
    });
    const body = JSON.parse(requestOptions.body);
    const input = JSON.parse(body.input);

    assert.equal(requestUrl, 'https://api.openai.com/v1/responses');
    assert.equal(requestOptions.headers.Authorization, 'Bearer test-key');
    assert.equal(body.store, false);
    assert.equal(body.text.format.name, 'account_closure_pre_review');
    assert.deepEqual(input, {
      accountRole: 'senior',
      accountTier: 'free_or_inactive',
      linkedRecordCounts: {
        professionalDocuments: 0,
        privateMessages: 0,
        notifications: 0,
        notificationDeliveries: 0,
        pushSubscriptions: 0,
        directoryBookings: 0,
        accountComplianceRecords: 0,
        organizations: 0,
        teamMemberships: 0,
        servicePartners: 0,
        liaisonLogs: 2,
        planningRecipients: 0,
        sharedNotes: 1,
        careVisits: 0,
        serviceBookings: 0,
        visitEvents: 0,
        visitEvaluations: 0,
        planningAccessAudits: 0,
        aiMessages: 0,
        wellbeingCheckins: 0,
        wellbeingCheckinShares: 0
      }
    });
    assert.doesNotMatch(body.input, /sensitive text|rawNoteContent/);
    assert.equal(summary.administratorDecisionRequired, true);
    assert.equal(summary.preliminaryJudgment, reviewResult.preliminaryJudgment);
  } finally {
    global.fetch = originalFetch;
  }
});

test('rejects incomplete or invalid data inventories instead of silently reporting zero', async () => {
  await assert.rejects(
    reviewAccountClosure({
      accountRole: 'aidant',
      accountTier: 'free_or_inactive',
      inventory: { ...emptyInventory, sharedNotes: -1 },
      apiKey: 'test-key'
    }),
    /décompte de la catégorie sharedNotes est invalide/
  );
});

test('rejects an AI response that does not require the administrator final decision', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    output_text: JSON.stringify({ ...reviewResult, administratorDecisionRequired: false })
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });

  try {
    await assert.rejects(
      reviewAccountClosure({
        accountRole: 'aidant',
        accountTier: 'free_or_inactive',
        inventory: emptyInventory,
        apiKey: 'test-key'
      }),
      error => error.status === 502
    );
  } finally {
    global.fetch = originalFetch;
  }
});
