-- The family domain is elum.services (it was the placeholder elum.example). Type addresses live on
-- type.elum.services. Belongs in the platform migrations; until it moves, run it from here.
-- Run before anyone takes a Type handle: addresses already given out keep their old domain.
update elum.config set value = 'type.elum.services' where key = 'type_domain' and value = 'type.elum.example';
update elum.services set url = replace(url, 'elum.example', 'elum.services') where url like '%elum.example%';
