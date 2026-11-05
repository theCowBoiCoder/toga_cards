<?php

namespace App\Filament\Pages;

use App\Models\AuditEvent;
use App\Models\User;
use Filament\Tables\Columns\TextColumn;

class Audit extends RecordsPage
{
    protected static ?string $title = 'Activity log';

    protected static ?string $navigationLabel = 'Activity log';

    protected static ?int $navigationSort = 90;

    protected function sourceRows(): array
    {
        $users = User::query()->pluck('name', 'id');

        return AuditEvent::query()->latest()->limit(500)->get()->map(fn (AuditEvent $event): array => [...$event->toArray(), 'operator' => $users[$event->user_id] ?? 'Former administrator', 'reference' => json_encode($event->parameters)])->all();
    }

    protected function columns(): array
    {
        return [TextColumn::make('created_at')->dateTime(), TextColumn::make('operator'), TextColumn::make('operation')->wrap(), TextColumn::make('outcome')->badge(), TextColumn::make('status_code')->label('Service status'), TextColumn::make('reference')->wrap()];
    }
}
