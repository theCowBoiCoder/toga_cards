<?php

namespace App\Filament\Pages;

use App\Models\AuditEvent;
use App\Models\User;
use Filament\Forms\Components\Checkbox;
use Filament\Forms\Components\TextInput;
use Filament\Notifications\Notification;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;

class Team extends RecordsPage
{
    protected static ?string $title = 'Admin accounts';

    protected static ?string $navigationLabel = 'Admin accounts';

    protected static ?int $navigationSort = 80;

    protected function sourceRows(): array
    {
        return User::query()->where('account_type', 'staff')->get(['id', 'name', 'email', 'is_admin', 'created_at'])->toArray();
    }

    protected function columns(): array
    {
        return [TextColumn::make('name'), TextColumn::make('email'), IconColumn::make('is_admin')->label('Access enabled')->boolean(), TextColumn::make('created_at')->dateTime()];
    }

    protected function getHeaderActions(): array
    {
        return [$this->adminAction('create')->label('Add administrator')->schema([TextInput::make('name')->required()->maxLength(100), TextInput::make('email')->email()->required()->unique('users'), TextInput::make('password')->password()->revealable()->minLength(12)->required(), Checkbox::make('is_admin')->label('Allow admin access')->default(true)])
            ->action(function (array $data): void {
                $this->client()->authorize();
                $user = User::create($data);
                AuditEvent::create(['user_id' => auth()->id(), 'operation' => 'admin-account:create', 'parameters' => ['userId' => $user->id], 'outcome' => 'succeeded']);
                Notification::make()->title('Administrator created')->success()->send();
                $this->resetTable();
            })];
    }

    protected function rowActions(): array
    {
        return [$this->adminAction('toggleAccess')->label(fn (array $record): string => $record['is_admin'] ? 'Disable access' : 'Enable access')->visible(fn (array $record): bool => $record['id'] !== auth()->id())->requiresConfirmation()
            ->action(function (array $record): void {
                $this->client()->authorize();
                abort_if($record['id'] === auth()->id(), 403);
                $user = User::where('account_type', 'staff')->findOrFail($record['id']);
                $user->update(['is_admin' => ! $user->is_admin]);
                AuditEvent::create(['user_id' => auth()->id(), 'operation' => 'admin-account:access', 'parameters' => ['userId' => $user->id, 'enabled' => $user->is_admin], 'outcome' => 'succeeded']);
                $this->resetTable();
            })];
    }
}
