-- Rename existing default groups to Hebrew labels
update groups
set name = 'לידים', sort_order = 10, type = 'lead_stage'
where name = 'New Leads';

update groups
set name = 'לקוחות', sort_order = 20, type = 'lead_stage'
where name = 'Contacted';

update groups
set name = 'לקוחות גדולים', sort_order = 30, type = 'lead_stage'
where name = 'Meeting Scheduled';

update groups
set name = 'ארכיון לקוחות', sort_order = 40, type = 'archive'
where name = 'Lost / Archive';

update groups
set name = 'לידים ישנים', sort_order = 50, type = 'lead_stage'
where name = 'Customers';

-- Ensure required groups exist with the exact order and types
insert into groups (name, sort_order, type)
select 'לידים', 10, 'lead_stage'
where not exists (select 1 from groups where name = 'לידים');

insert into groups (name, sort_order, type)
select 'לקוחות', 20, 'lead_stage'
where not exists (select 1 from groups where name = 'לקוחות');

insert into groups (name, sort_order, type)
select 'לקוחות גדולים', 30, 'lead_stage'
where not exists (select 1 from groups where name = 'לקוחות גדולים');

insert into groups (name, sort_order, type)
select 'ארכיון לקוחות', 40, 'archive'
where not exists (select 1 from groups where name = 'ארכיון לקוחות');

insert into groups (name, sort_order, type)
select 'לידים ישנים', 50, 'lead_stage'
where not exists (select 1 from groups where name = 'לידים ישנים');

insert into groups (name, sort_order, type)
select 'לא רלוונטי', 60, 'lead_stage'
where not exists (select 1 from groups where name = 'לא רלוונטי');
