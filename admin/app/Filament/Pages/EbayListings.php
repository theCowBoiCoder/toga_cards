<?php

namespace App\Filament\Pages;

use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Tables\Columns\TextColumn;

class EbayListings extends RecordsPage
{
    protected static ?string $title = 'eBay listings';

    protected static ?string $navigationLabel = 'eBay listings';

    protected static ?int $navigationSort = 50;

    protected string $view = 'filament.pages.ebay-listings';

    public function connection(): array
    {
        return $this->client()->get('/api/ebay');
    }

    protected function sourceRows(): array
    {
        return collect($this->connection()['listings'])->filter(fn (array $row): bool => $row['active'])->map(fn (array $row): array => [...$row, 'id' => hash('sha256', $row['key']), 'match' => $row['cardId'] ? 'Matched' : 'Needs matching'])->all();
    }

    protected function columns(): array
    {
        return [TextColumn::make('title')->wrap(), TextColumn::make('sku'), TextColumn::make('available')->label('eBay available'), TextColumn::make('match')->badge(), TextColumn::make('cardId')->label('Inventory ID')->placeholder('Unmatched')];
    }

    protected function rowActions(): array
    {
        return [$this->adminAction('match')->schema([Select::make('cardId')->label('Exact inventory card')->searchable()->getSearchResultsUsing(fn (string $search): array => $this->cardOptions($search))->required()])->action(fn (array $data, array $record) => $this->perform('/api/ebay/action', ['action' => 'map', 'key' => $record['key'], 'cardId' => $data['cardId']], 'Listing matched'))];
    }

    protected function getHeaderActions(): array
    {
        return [$this->adminAction('sync')->label('Import eBay now')->action(fn () => $this->perform('/api/ebay/action', ['action' => 'sync'], 'eBay imported')),
            $this->adminAction('settings')->label('OAuth settings')->fillForm(fn (): array => ['ruName' => $this->connection()['ruName'] ?? ''])->schema([TextInput::make('ruName')->label('Production RuName')->required()->maxLength(300)])->action(fn (array $data) => $this->perform('/api/ebay/action', ['action' => 'settings', ...$data], 'OAuth settings saved')),
            $this->adminAction('finishStocktake')->label('Finish stocktake')->requiresConfirmation()->modalDescription('Enable automatic deductions for newly paid, mapped eBay orders after completing the stock review.')->action(fn () => $this->perform('/api/ebay/action', ['action' => 'automatic', 'enabled' => true], 'Automatic order deductions enabled'))];
    }
}
