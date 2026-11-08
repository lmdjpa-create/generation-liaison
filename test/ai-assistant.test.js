const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  generateReply,
  generateWellbeingAssessment,
  generateWellbeingReply
} = require('../ai-assistant');

test('requires an OpenAI API key configured on the server', async () => {
  await assert.rejects(
    generateReply({ name: 'Jeanne', messages: [], apiKey: '' }),
    error => error.status === 503
  );
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
