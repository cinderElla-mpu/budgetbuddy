const liveServerPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  && window.location.port === '5500';

window.budgetBuddyConfig = {
  supabaseUrl: 'https://plagmjgcstgfbwmzxlzu.supabase.co',
  supabaseAnonKey: 'sb_publishable_6BKh8DT7cTixfVLCCatwhQ_tJLeRIE1',
  apiBaseUrl: liveServerPreview ? 'http://localhost:3000' : '',
};