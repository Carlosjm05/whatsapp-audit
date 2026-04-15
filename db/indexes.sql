-- ══════════════════════════════════════════════════════════════
-- ÍNDICES DE RENDIMIENTO
-- ══════════════════════════════════════════════════════════════

-- raw_conversations
CREATE INDEX idx_raw_conv_chat_id ON raw_conversations(chat_id);
CREATE INDEX idx_raw_conv_phone ON raw_conversations(phone);
CREATE INDEX idx_raw_conv_status ON raw_conversations(extraction_status);
CREATE INDEX idx_raw_conv_dates ON raw_conversations(first_message_at, last_message_at);

-- messages
CREATE INDEX idx_messages_conv_id ON messages(conversation_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);
CREATE INDEX idx_messages_type ON messages(message_type);
CREATE INDEX idx_messages_sender ON messages(sender);
CREATE INDEX idx_messages_conv_timestamp ON messages(conversation_id, timestamp);

-- transcriptions
CREATE INDEX idx_transcriptions_msg_id ON transcriptions(message_id);
CREATE INDEX idx_transcriptions_conv_id ON transcriptions(conversation_id);
CREATE INDEX idx_transcriptions_status ON transcriptions(status);
CREATE INDEX idx_transcriptions_confidence ON transcriptions(confidence_score);

-- leads
CREATE INDEX idx_leads_conv_id ON leads(conversation_id);
CREATE INDEX idx_leads_phone ON leads(phone);
CREATE INDEX idx_leads_status ON leads(analysis_status);
CREATE INDEX idx_leads_name ON leads(real_name);
CREATE INDEX idx_leads_source ON leads(lead_source);

-- lead_interests
CREATE INDEX idx_interests_lead ON lead_interests(lead_id);
CREATE INDEX idx_interests_product ON lead_interests(product_type);
CREATE INDEX idx_interests_project ON lead_interests(project_name);

-- lead_financials
CREATE INDEX idx_financials_lead ON lead_financials(lead_id);
CREATE INDEX idx_financials_range ON lead_financials(budget_range);
CREATE INDEX idx_financials_method ON lead_financials(payment_method);

-- lead_intent
CREATE INDEX idx_intent_lead ON lead_intent(lead_id);
CREATE INDEX idx_intent_score ON lead_intent(intent_score);
CREATE INDEX idx_intent_urgency ON lead_intent(urgency);

-- lead_objections
CREATE INDEX idx_objections_lead ON lead_objections(lead_id);
CREATE INDEX idx_objections_type ON lead_objections(objection_type);
CREATE INDEX idx_objections_resolved ON lead_objections(was_resolved);

-- conversation_metrics
CREATE INDEX idx_metrics_lead ON conversation_metrics(lead_id);
CREATE INDEX idx_metrics_conv ON conversation_metrics(conversation_id);

-- response_times
CREATE INDEX idx_response_lead ON response_times(lead_id);
CREATE INDEX idx_response_category ON response_times(response_time_category);

-- advisor_scores
CREATE INDEX idx_advisor_lead ON advisor_scores(lead_id);
CREATE INDEX idx_advisor_name ON advisor_scores(advisor_name);
CREATE INDEX idx_advisor_overall ON advisor_scores(overall_score);
CREATE INDEX idx_advisor_conv ON advisor_scores(conversation_id);

-- conversation_outcomes
CREATE INDEX idx_outcomes_lead ON conversation_outcomes(lead_id);
CREATE INDEX idx_outcomes_status ON conversation_outcomes(final_status);
CREATE INDEX idx_outcomes_recoverable ON conversation_outcomes(is_recoverable);
CREATE INDEX idx_outcomes_priority ON conversation_outcomes(recovery_priority);
CREATE INDEX idx_outcomes_probability ON conversation_outcomes(recovery_probability);

-- competitor_intel
CREATE INDEX idx_competitor_lead ON competitor_intel(lead_id);
CREATE INDEX idx_competitor_name ON competitor_intel(competitor_name);

-- dapta_knowledge_base
CREATE INDEX idx_dapta_type ON dapta_knowledge_base(entry_type);
CREATE INDEX idx_dapta_category ON dapta_knowledge_base(category);
CREATE INDEX idx_dapta_frequency ON dapta_knowledge_base(frequency_count DESC);
CREATE INDEX idx_dapta_project ON dapta_knowledge_base(related_project);

-- system_logs
CREATE INDEX idx_logs_module ON system_logs(module);
CREATE INDEX idx_logs_level ON system_logs(level);
CREATE INDEX idx_logs_created ON system_logs(created_at DESC);

-- processing_stats
CREATE INDEX idx_stats_module ON processing_stats(module);
CREATE INDEX idx_stats_key ON processing_stats(stat_key);

-- Índice de texto completo para búsqueda en transcripciones
CREATE INDEX idx_transcriptions_text_search ON transcriptions USING gin(to_tsvector('spanish', COALESCE(transcription_text, '')));

-- Índice de texto completo para búsqueda en resúmenes
CREATE INDEX idx_summaries_text_search ON conversation_summaries USING gin(to_tsvector('spanish', COALESCE(summary_text, '')));
