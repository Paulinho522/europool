// js/supabase-client.js
// Inicializa o cliente Supabase — importado por todas as páginas via <script>
const SUPABASE_URL  = 'https://rfrbvihjgyfblqrbfppn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmcmJ2aWhqZ3lmYmxxcmJmcHBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNTUwMjgsImV4cCI6MjA5NzYzMTAyOH0.63d0M3pL4N8pChpJ2YNrQmBzKpDIy4aakk9RwcJjA0Q';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
