const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  generateAdminReply,
  generateReply,
  generateWellbeingAssessment,
  generateWellbeingReply,
  suggestMessageRewrite,
  reviewSiteMetrics
} = require('../ai-assistant');

test('requires an OpenAI API key configured on the server', async () => {
  await assert.rejects(
    generateReply({ name: 'Jeanne', messages: [], apiKey: '' }),
    error => error.status === 503
  );
});

test('rejects malformed API keys without exposing them or calling OpenAI', async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => { fetchCalled = true; };
  try {
    for (const apiKey of ['sk-test’cle', 'sk-test\ncle', ' sk-test', '"sk-test"', 'sk-test secret']) {
      await assert.rejects(
        generateAdminReply({ messages: [{ role: 'user', content: 'Bonjour' }], apiKey }),
        error => error.status === 503 && /clé OpenAI.*invalide/.test(error.message) && !error.message.includes(apiKey)
      );
    }
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('site review receives the weather quota instruction without claiming quota monitoring or web access', async () => {
  const originalFetch = global.fetch;
  let payload;
  global.fetch = async (url, options) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ output_text: 'Vérifiez les compteurs.' }), { status: 200 });
  };
  try {
    const metrics = { requests: 2, serverErrors: 0 };
    await reviewSiteMetrics({ metrics, apiKey: 'test-key' });
    assert.match(payload.instructions, /quota journalier du fournisseur météo/);
    assert.match(payload.instructions, /rechercher un autre fournisseur/);
    assert.match(payload.instructions, /Ne déduis pas l'utilisation du quota/);
    assert.match(payload.instructions, /pas accès à Internet ni au quota météo/);
    assert.deepEqual(payload.input, [{ role: 'user', content: JSON.stringify(metrics) }]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('message rewrite sends only the draft with storage disabled and rejects oversized output', async () => {
  const originalFetch = global.fetch;
  let payload;
  let output = 'Bonjour, comment allez-vous ?';
  global.fetch = async (url, options) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ output_text: output }), { status: 200 });
  };
  try {
    assert.equal(await suggestMessageRewrite({ message: 'Bonjour, ça va ?', apiKey: 'test-key' }), output);
    assert.equal(payload.store, false);
    assert.deepEqual(payload.input, [{ role: 'user', content: 'Bonjour, ça va ?' }]);
    assert.match(payload.instructions, /n'invente aucune information/);
    output = 'a'.repeat(2001);
    await assert.rejects(suggestMessageRewrite({ message: 'Bonjour', apiKey: 'test-key' }), error => error.status === 502);
  } finally {
    global.fetch = originalFetch;
  }
});

test('sends only the supplied conversation and disables API response storage', async () => {
  const originalFetch = global.fetch;
  let requestUrl;
  let requestOptions;
  global.fetch = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return new Response(JSON.stringify({ output_text: 'Bonjour Jeanne.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const reply = await generateReply({
      name: 'Jeanne',
      messages: [{ role: 'user', content: 'Bonjour' }],
      apiKey: 'test-key'
    });
    const body = JSON.parse(requestOptions.body);

    assert.equal(requestUrl, 'https://api.openai.com/v1/responses');
    assert.equal(requestOptions.headers.Authorization, 'Bearer test-key');
    assert.equal(body.store, false);
    assert.match(body.instructions, /Jeanne/);
    assert.deepEqual(body.input, [{ role: 'user', content: 'Bonjour' }]);
    assert.equal(reply, 'Bonjour Jeanne.');
  } finally {
    global.fetch = originalFetch;
  }
});

test('adds administrator instructions without replacing the assistant safety rules', async () => {
  const originalFetch = global.fetch;
  let payload;
  global.fetch = async (url, options) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ output_text: 'Bonjour.' }), { status: 200 });
  };
  try {
    await generateReply({
      name: 'Jeanne',
      messages: [{ role: 'user', content: 'Bonjour' }],
      apiKey: 'test-key',
      customInstructions: 'Utilise des phrases très courtes.'
    });
    assert.match(payload.instructions, /Utilise des phrases très courtes/);
    assert.match(payload.instructions, /Tu ne poses pas de diagnostic/);
    assert.match(payload.instructions, /ne demandes pas d’informations médicales/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('admin chat uses only submitted messages and has no site or action access', async () => {
  const originalFetch = global.fetch;
  let payload;
  global.fetch = async (url, options) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ output_text: 'Je peux vous expliquer les rubriques.' }), { status: 200 });
  };
  try {
    const messages = [{ role: 'user', content: 'Comment gérer les services ?' }];
    const reply = await generateAdminReply({ messages, apiKey: 'test-key' });
    assert.equal(reply, 'Je peux vous expliquer les rubriques.');
    assert.equal(payload.store, false);
    assert.deepEqual(payload.input, messages);
    assert.match(payload.instructions, /Tu n’as accès ni au site/);
    assert.match(payload.instructions, /Tu ne peux exécuter aucune action administrative/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('sends only the submitted wellbeing text to OpenAI without storing the response', async () => {
  const originalFetch = global.fetch;
  let requestOptions;
  global.fetch = async (url, options) => {
    requestOptions = options;
    return new Response(JSON.stringify({ output_text: 'Merci de me l’avoir dit.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const reply = await generateWellbeingReply({
      message: 'Je me sens bien ce matin.',
      apiKey: 'test-key'
    });
    const body = JSON.parse(requestOptions.body);

    assert.equal(body.store, false);
    assert.match(body.instructions, /sans diagnostic/);
    assert.match(body.instructions, /112/);
    assert.match(body.instructions, /18 pour les pompiers/);
    assert.deepEqual(body.input, [{ role: 'user', content: 'Je me sens bien ce matin.' }]);
    assert.equal(reply, 'Merci de me l’avoir dit.');
  } finally {
    global.fetch = originalFetch;
  }
});

test('returns a structured, indicative safety signal with the wellbeing response', async () => {
  const originalFetch = global.fetch;
  let requestOptions;
  global.fetch = async (url, options) => {
    requestOptions = options;
    return new Response(JSON.stringify({
      output_text: JSON.stringify({
        reply: 'Est-ce que vous êtes en sécurité et avez-vous besoin d’aide ?',
        safetyConcern: true
      })
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const assessment = await generateWellbeingAssessment({
      message: 'Je suis en danger et j’ai besoin d’aide.',
      apiKey: 'test-key'
    });
    const body = JSON.parse(requestOptions.body);

    assert.equal(body.store, false);
    assert.equal(body.text.format.name, 'wellbeing_checkin_assessment');
    assert.match(body.instructions, /La tristesse, la solitude, la fatigue/);
    assert.deepEqual(body.input, [{
      role: 'user',
      content: 'Je suis en danger et j’ai besoin d’aide.'
    }]);
    assert.deepEqual(assessment, {
      reply: 'Est-ce que vous êtes en sécurité et avez-vous besoin d’aide ?',
      safetyConcern: true
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('rejects malformed structured wellbeing safety assessments', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    output_text: JSON.stringify({ reply: 'Bonjour', safetyConcern: 'maybe' })
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });

  try {
    await assert.rejects(
      generateWellbeingAssessment({
        message: 'Je vais bien.',
        apiKey: 'test-key'
      }),
      error => error.status === 502
    );
  } finally {
    global.fetch = originalFetch;
  }
});
